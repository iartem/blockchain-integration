const MongoClient = require('mongodb').MongoClient;

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
		return this.client ? this.client.close() : Promise.resolve();
	}

	reconnect () {
		if (this.client) {
			this.close();
		}

		this.log.info(`Connecting in store: ${this.CFG.store}`);
		this.connectPromise = MongoClient.connect(this.CFG.store, {connectTimeoutMS: 3000, socketTimeoutMS: 3000})
			.then(client => {
				this.connected = true;
				this.connectionErrors = 0;
				this.connectPromise = null;

				this.client = client;
				this.db = client.db(this.CFG.store.split('/').pop());

				this.Addresses = this.db.collection('addresses');
				this.Transactions = this.db.collection('transactions');

				return this;
			}, err => {
				if (!this.connected) {
					this.connectionErrors++;
				}
				this.log.error(`Error in store: ${err.message || 'Unknown error'}`);

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

	address (id) {
		return this.Addresses.findById(id);
	}

	tx (id, data) {
		if (data) {
			return this.update(this.Transactions, id, data);
		} else {
			return this.findOne(this.Transactions, id);
		}
	}

	txDelete (id) {
		return this.Transactions.deleteOne({_id: id}).then(d => d.deletedCount);
	}

	op (opid, data) {
		if (data) {
			return this.update(this.Transactions, {op: opid}, data);
		} else {
			return this.findOne(this.Transactions, {op: opid});
		}
	}

	findOne (collection, id) {
		return collection.findOne(typeof id === 'object' ? id : {_id: id});
	}

	update (collection, id, data, upsert=true) {
		if (typeof id !== 'object') {
			data._id = data._id || id;
		}
		let update = Object.keys(data).filter(k => k[0] === '$').length ? data : {$set: data};
		return collection.updateOne(typeof id === 'object' ? id : {_id: id}, update, {upsert: upsert}).then(d => d.upsertedCount || d.modifiedCount, this.log.warn.bind(this.log));
	}

	delete (collection, id) {
		return collection.deleteOne({_id: id}).then(d => d.deletedCount);
	}

}

module.exports = MongoStore;
