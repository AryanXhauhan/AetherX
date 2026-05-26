import { parentPort } from 'worker_threads';
class OrderQueue {
    head = null;
    tail = null;
    volume = 0;
    push(order) {
        if (!this.head) {
            this.head = order;
            this.tail = order;
        }
        else {
            order.prev = this.tail;
            if (this.tail)
                this.tail.next = order;
            this.tail = order;
        }
        this.volume += order.quantity;
    }
    shift() {
        if (!this.head)
            return null;
        const node = this.head;
        this.head = node.next;
        if (this.head)
            this.head.prev = null;
        else
            this.tail = null;
        node.next = null;
        this.volume -= node.quantity;
        return node;
    }
    remove(order) {
        if (order.prev)
            order.prev.next = order.next;
        else
            this.head = order.next;
        if (order.next)
            order.next.prev = order.prev;
        else
            this.tail = order.prev;
        order.prev = null;
        order.next = null;
        this.volume -= order.quantity;
    }
}
class OrderBook {
    symbol;
    bids = new Map(); // price -> Queue
    asks = new Map(); // price -> Queue
    orderMap = new Map(); // orderId -> Node
    // Maintain sorted price levels for fast matching
    // Arrays are fast enough for iterating distinct price levels, but a BST would be better for massive ranges.
    // We'll keep sorted arrays of active price levels.
    bidPrices = []; // descending
    askPrices = []; // ascending
    constructor(symbol) {
        this.symbol = symbol;
    }
    addOrder(order) {
        const node = {
            id: order.id,
            userId: order.userId,
            side: order.side,
            price: order.price,
            quantity: order.quantity,
            prev: null,
            next: null
        };
        if (order.side === 'BUY') {
            this.matchOrder(node, this.askPrices, this.asks, true);
            if (node.quantity > 0 && node.price > 0) {
                this.insertResting(node, this.bids, this.bidPrices, (a, b) => b - a);
            }
        }
        else {
            this.matchOrder(node, this.bidPrices, this.bids, false);
            if (node.quantity > 0 && node.price > 0) {
                this.insertResting(node, this.asks, this.askPrices, (a, b) => a - b);
            }
        }
        // Broadcast orderbook update
        this.broadcastDepth();
    }
    cancelOrder(orderId) {
        const entry = this.orderMap.get(orderId);
        if (!entry)
            return;
        const { node, price } = entry;
        if (node.side === 'BUY') {
            const queue = this.bids.get(price);
            if (queue)
                queue.remove(node);
            if (queue && queue.head === null) {
                this.bids.delete(price);
                this.bidPrices = this.bidPrices.filter(p => p !== price);
            }
        }
        else {
            const queue = this.asks.get(price);
            if (queue)
                queue.remove(node);
            if (queue && queue.head === null) {
                this.asks.delete(price);
                this.askPrices = this.askPrices.filter(p => p !== price);
            }
        }
        this.orderMap.delete(orderId);
        this.broadcastDepth();
    }
    insertResting(node, levels, prices, sortFn) {
        let queue = levels.get(node.price);
        if (!queue) {
            queue = new OrderQueue();
            levels.set(node.price, queue);
            prices.push(node.price);
            prices.sort(sortFn);
        }
        queue.push(node);
        this.orderMap.set(node.id, { node, price: node.price });
    }
    matchOrder(taker, makerPrices, makerLevels, isBuy) {
        let i = 0;
        while (i < makerPrices.length && taker.quantity > 0) {
            const bestPrice = makerPrices[i];
            // Check if limit price crosses
            if (taker.price > 0) { // If not market order
                if (isBuy && taker.price < bestPrice)
                    break;
                if (!isBuy && taker.price > bestPrice)
                    break;
            }
            const queue = makerLevels.get(bestPrice);
            let maker = queue.head;
            while (maker && taker.quantity > 0) {
                const matchQty = Math.min(taker.quantity, maker.quantity);
                taker.quantity -= matchQty;
                maker.quantity -= matchQty;
                queue.volume -= matchQty;
                // Emit match event
                if (parentPort) {
                    parentPort.postMessage({
                        type: 'TRADE_EXECUTED',
                        payload: {
                            symbol: this.symbol,
                            price: bestPrice,
                            quantity: matchQty,
                            buyerId: isBuy ? taker.userId : maker.userId,
                            sellerId: isBuy ? maker.userId : taker.userId,
                            makerOrderId: maker.id,
                            takerOrderId: taker.id,
                            timestamp: Date.now()
                        }
                    });
                }
                if (maker.quantity === 0) {
                    queue.shift(); // remove fully filled maker
                    this.orderMap.delete(maker.id);
                    maker = queue.head;
                }
            }
            if (queue.head === null) {
                makerLevels.delete(bestPrice);
                makerPrices.splice(i, 1);
            }
            else {
                i++; // this shouldn't happen unless taker is 0, but just in case to prevent inf loops
            }
        }
    }
    broadcastDepth() {
        if (!parentPort)
            return;
        // Send top 20 levels
        const bids = this.bidPrices.slice(0, 20).map(p => ({ price: p, volume: this.bids.get(p)?.volume || 0 }));
        const asks = this.askPrices.slice(0, 20).map(p => ({ price: p, volume: this.asks.get(p)?.volume || 0 }));
        parentPort.postMessage({
            type: 'DEPTH_UPDATE',
            payload: { symbol: this.symbol, bids, asks }
        });
    }
}
const orderBooks = new Map();
if (parentPort) {
    parentPort.on('message', (msg) => {
        try {
            const { type, payload } = msg;
            let book = orderBooks.get(payload.symbol);
            if (!book && payload.symbol) {
                book = new OrderBook(payload.symbol);
                orderBooks.set(payload.symbol, book);
            }
            switch (type) {
                case 'ADD_ORDER':
                    if (book)
                        book.addOrder(payload);
                    break;
                case 'CANCEL_ORDER':
                    if (book)
                        book.cancelOrder(payload.id);
                    break;
                case 'GET_DEPTH':
                    if (book)
                        book['broadcastDepth']();
                    break;
            }
        }
        catch (err) {
            console.error('Worker matching error:', err);
        }
    });
}
