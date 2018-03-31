const driver = require('mongodb'),
	MongoClient = driver.MongoClient,
	ObjectId = driver.ObjectId;

class MongoStore {
	constructor(CFG, log) {
		this.connected = false;
		this.connectionErrors = 0;
		this.log = log('store');
		this.CFG = CFG;
	}

	connect () {
		return this.connectPromise || this.reconnect();
	}

	close () {
		// return Promise.resolve();
		return this.client ? this.client.close() : Promise.resolve();
	}

	oid () {
		return ObjectId.apply(driver, arguments);
	}

	reconnect () {
		if (this.client) {
			this.close();
		}

		this.log.info(`Connecting in store: ${this.CFG.store}`);
		this.connectPromise = MongoClient.connect(this.CFG.store, {connectTimeoutMS: 3000, socketTimeoutMS: 3000})
			.then(async client => {
				this.connected = true;
				this.connectionErrors = 0;
				this.connectPromise = null;

				this.client = client;
				this.db = client.db(this.CFG.store.split('/').pop());

				this.Accounts = this.db.collection('accounts');
				this.Transactions = this.db.collection('transactions');

				let indexesExist = await this.Transactions.indexExists('hash').catch(() => {});
				if (!indexesExist) {
					await this.Transactions.createIndexes([
						{key: {hash: 1}, name: 'hash', unique: true, partialFilterExpression: {hash: {$exists: true, $type: 'string'}}},
						{key: {opid: 1}, name: 'opid', unique: true, partialFilterExpression: {opid: {$exists: true, $type: 'string'}}},
					]);

					await this.Accounts.createIndexes([
						{key: {paymentId: 1}, name: 'paymentId', unique: true},
					]);
				}

				return this;
			}, err => {
				if (!this.connected) {
					this.connectionErrors++;
				}
				this.log.error(err, 'Error in store');

				if (this.connectionErrors < 3) {
					return this.reconnect();
				} else {
					this.connected = false;
					this.connectionErrors = 0;
					this.connectPromise = null;
					this.close();
				}
			});

		return this.connectPromise;
	}

	account (id, data, upsert, atomic) {
		if (data) {
			if (atomic) {
				return this.findOneAndUpdate(this.Accounts, id, data);
			} else {
				return this.update(this.Accounts, id, data, upsert);
			}
		} else {
			return this.findOne(this.Accounts, id);
		}
	}

	accountFind (query, fields, offset, limit, sort) {
		return this.findMany(this.Accounts, query, fields, offset, limit, sort);
	}

	accountCreate (data) {
		return this.create(this.Accounts, data);
	}

	accountDelete (id) {
		return this.delete(this.Accounts, id);
	}

	tx (id, data, upsert, atomic) {
		if (data) {
			if (atomic) {
				return this.findOneAndUpdate(this.Transactions, id, data);
			} else {
				return this.update(this.Transactions, id, data, upsert);
			}
		} else {
			return this.findOne(this.Transactions, id);
		}
	}

	txFind (query, fields, offset, limit, sort) {
		return this.findMany(this.Transactions, query, fields, offset, limit, sort);
	}

	txHistory (query, query2, limit, after) {
		console.log([
			{$match: query},
			{$sort: {timestamp: 1}},
			{$unwind: '$operations'}, 
			{$project: {
				_id: 1,
				opid: 1, 
				timestamp: 1, 
				hash: 1, 
				bounce: 1,
				bounced: 1,
				from: '$operations.from', 
				sourcePaymentId: '$operations.sourcePaymentId',
				to: '$operations.to',
				paymentId: '$operations.paymentId',
				amount: '$operations.amount', 
				fee: '$operations.fee', 
			}},
			{$match: query2},
			{$match: {hash: {$gt: after || ''}}},
			{$limit: limit},
		]);
		return this.Transactions.aggregate([
			{$match: query},
			{$sort: {timestamp: 1}},
			{$unwind: '$operations'}, 
			{$project: {
				_id: 1,
				opid: 1, 
				timestamp: 1, 
				hash: 1, 
				bounce: 1,
				bounced: 1,
				from: '$operations.from', 
				sourcePaymentId: '$operations.sourcePaymentId',
				to: '$operations.to',
				paymentId: '$operations.paymentId',
				amount: '$operations.amount', 
				fee: '$operations.fee', 
			}},
			{$match: query2},
			{$match: {hash: {$gt: after || ''}}},
			{$limit: limit},
		]).toArray();
		// return this.findMany(this.Transactions, query, fields, offset, limit, sort);
	}

	txCreate (data) {
		return this.create(this.Transactions, data);
	}

	txDelete (id) {
		return this.delete(this.Transactions, id);
	}

	// async historyObserving (address) {
	// 	let obj = this.findOne(this.HistoryObserving, address);
	// 	if (!obj) {
	// 		return {address: address, incoming: false, outgoing: false};
	// 	} else {
	// 		return {address: address, incoming: obj.mode & 1, outgoing: obj.mode & 2};
	// 	}
	// }

	// historyObserve (address, incoming) {
	// 	return this.update(this.HistoryObserving, {$bit: {mode: {$or: incoming ? 1 : 2}}});
	// }

	// historyUnobserve (address, incoming) {
	// 	return this.update(this.HistoryObserving, {$bit: {mode: {$xor: incoming ? 1 : 2}}});
	// }

	findOne (collection, id) {
		this.log.debug(`FINDONE ${collection.s.name}: ${typeof id === 'string' ? id : JSON.stringify(id)}`);
		return collection.findOne(typeof id === 'object' && !(id instanceof ObjectId) ? id : {_id: id});
	}

	findMany (collection, query, fields, offset, limit, sort) {
		let opts = {};
		if (fields && Object.keys(fields).length) {
			opts.projection = fields;
		}

		let cursor = collection.find(query || {}, opts);

		if (offset !== undefined) {
			cursor.skip(offset);
		}

		if (limit !== undefined) {
			cursor.limit(limit);
		}

		if (sort !== undefined) {
			cursor.sort(sort);
		}

		this.log.debug(`FINDMANY ${collection.s.name}: query ${JSON.stringify(query)}, fields ${JSON.stringify(fields)}, offset ${JSON.stringify(offset)}, limit ${JSON.stringify(limit)}, sort ${JSON.stringify(sort)}`);
		return cursor.toArray().catch(e => {
			this.log.error(e, 'Error in FINDMANY');
		});
	}

	async create (collection, data) {
		try {
			this.log.debug(`INSERT ${collection.s.name}: ${JSON.stringify(data)}`);
			let res = await collection.insertOne(data);
			data._id = res.insertedId;
			return data;
		} catch (e) {
			return 0;
		}
	}

	update (collection, id, data, upsert=true) {
		let modifiers = Object.keys(data).filter(k => k[0] === '$').length > 0;

		if (!modifiers && typeof id !== 'object') {
			data._id = data._id || id;
		}

		let update = modifiers ? data : {$set: data};
		
		this.log.debug(`UPDATE ${collection.s.name}: ${JSON.stringify(typeof id === 'object' && !(id instanceof ObjectId) ? id : {_id: id})}, ${JSON.stringify(update)}, upsert ${upsert}`);
		return collection.updateOne(typeof id === 'object' && !(id instanceof ObjectId) ? id : {_id: id}, update, {upsert: upsert}).then(d => d.upsertedCount || d.modifiedCount).catch(e => {
			this.log.error(e, 'Error in UPDATE');
		});
	}

	findOneAndUpdate (collection, query, data) {
		let update = Object.keys(data).filter(k => k[0] === '$').length > 0 ? data : {$set: data};
		
		this.log.debug(`FINDANDMODIFY ${collection.s.name}: ${JSON.stringify(query)}, ${JSON.stringify(update)}`);
		return collection.findOneAndUpdate(query, update).then(d => d.ok && d.value, e => {
			this.log.error(e, 'Error in FINDANDMODIFY');
		});
	}

	delete (collection, id) {
		this.log.debug(`DELETE ${collection.s.name}: ${JSON.stringify(id)}`);
		return collection.deleteOne(typeof id === 'string' || (id instanceof ObjectId) ? {_id: id} : id).then(d => d.deletedCount, e => {
			this.log.error(e, 'Error in DELETE');
		});
	}

}

module.exports = MongoStore;
