
const Status = {
	Initial: 	'initial',		// just created
	Sent: 		'sent',			// broadcasted
	Locked:		'locked',		// confirmed, but amount not available for use (monero)
	Completed: 	'completed',	// confirmed, completed, ready to withdraw
	Failed: 	'failed'		// error
};

class Operation {
	constructor(from, to, asset, amount, sourcePaymentId, paymentId) {
		this.id = undefined;
		this.from = from;
		this.to = to;
		this.asset = asset;
		this.amount = amount;
		this.fee = 0;
		this.paymentId = '' + (paymentId || '');
		this.sourcePaymentId = '' + (sourcePaymentId || '');
	}

	eq (op) {
		if (!(op instanceof Operation)) { return false; }
		return this.from === op.from && this.to === op.to && this.paymentId === op.paymentId && this.sourcePaymentId === op.sourcePaymentId;
	}
}

Operation.fromJSON = data => {
	let o = new Operation();
	Object.keys(data).forEach(k => o[k] = data[k]);
	return o;
};

class Tx {
	constructor(_id, priority=-1, unlock=-1) {
		this._id = _id;
		this.priority = priority;
		this.unlock = unlock;
		this.operations = [];
		this.hash = undefined;
		this.block = -1;
		this.timestamp = undefined;
		this.error = undefined;
		this.status = Status.Initial;
		// this.bounce = 123;			// whether this transaction is a bounce transaction, that is return of unidentifiable funds cashed in without payment id 
										// or with invalid paymentId (no such address in db, not a funds adding payment id of CFG.bounce)
										// undefined means not a bounce tx
										// number means random sourcePaymentId 
		// this.bounced = false;		// whether this transaction requires a bounce transaction or it has been already bounced
										// {@code bounced == false} means tx needs a bounce, but hasn't been yet bounced
										// {@code bounced == true} means tx has been successuflly bounced
	}

	get amount () { return this.operations.map(o => o.amount).reduce((a, b) => a + b); }

	get fees () { return this.operations.map(o => o.fee).reduce((a, b) => a + b); }

	get dwhw () { return this.operations.filter(o => o.from === o.to && o.sourcePaymentId && !o.paymentId).length === this.operations.length; }

	equals (tx) {
		if (!(tx instanceof Tx)) { return false; }
		if (this.operations.length !== tx.operations.length || this.destinations.length !== tx.destinations.length) { return false; }
		if (this.id !== tx.id || this.status !== tx.status) { return false; }
		return true;
	}

	toJSON() {
		let o = {
			_id: this._id,
			opid: this.opid,
			priority: this.priority,
			unlock: this.unlock,
			operations: this.operations,
			hash: this.hash,
			block: this.block,
			page: this.page,
			timestamp: this.timestamp,
			error: this.error,
			status: this.status,
		};
		if (this.bounce !== undefined) {
			o.bounce = this.bounce;
		}
		if (this.bounced !== undefined) {
			o.bounced = this.bounced;
		}
		return o;
	}

	addPayment(from, to, asset, amount, sourcePaymentId, paymentId) {
		let o = new Operation(from, to, asset, parseInt(amount), sourcePaymentId, paymentId);
		this.operations.push(o);
		return o;
	}

	sourceAmount (address) {
		let source = this.operations.filter(o => o.from === address)[0];
		return source && source.amount;
	}

	destinationAmount (address) {
		let destination = this.operations.filter(o => o.to === address)[0];
		return destination && destination.amount;
	}

	toString() {
		return JSON.stringify(this);
	}
}

Tx.Status = Status;

Tx.fromJSON = data => {
	let tx = new Tx(data._id, data.priority || -1, data.unlock || -1);
	tx.opid = data.opid;
	tx.operations = data.operations.map(Operation.fromJSON);

	if (data.hash !== undefined) { tx.hash = data.hash; }
	if (data.block !== undefined) { tx.block = data.block; }
	if (data.page !== undefined) { tx.page = data.page; }
	if (data.timestamp !== undefined) { tx.timestamp = data.timestamp; }
	if (data.error !== undefined) { tx.error = data.error; }
	if (data.status !== undefined) { tx.status = data.status; }

	return tx;
};

/**
 * Abstraction class encapsulating status & details of transaction.
 * Just to keep field naming standard.
 */
class TxInfo {
	constructor(hash) {
		// id or hash of tx
		this.hash = hash;
		// confirmation of tx if any
		this.key = undefined;
		// block number, sequence number
		this.block = undefined;
		// payment id for incoming tx
		this.paymentId = undefined;
		// amount (number)
		this.amount = undefined;
		// incoming or outgoing (bool)
		this.in = undefined;
		// timestamp (unix ms)
		this.timestamp = undefined;
		// Status enum
		this.status = undefined;
		// fees amount for incoming tx (number)
		this.fees = undefined;
	}

	toString() {
		return JSON.stringify(this);
	}
}

Tx.Info = TxInfo;

// /**
//  * Abstraction history class just to keep field names
//  */
// class History {
// 	constructor () {
// 		// ObjectId
// 		this._id = undefined;
// 		// blockchain id
// 		this.hash = undefined;
// 		// guid
// 		this.op = undefined;
// 		// from address
// 		this.from = undefined;
// 		// to address
// 		this.to = undefined;
// 		// number
// 		this.amount = undefined;
// 		// unix ms
// 		this.timestamp = undefined;
// 	}
// }

// History.fromJSON = data => {
// 	let h = new History();
// 	Object.keys(data).forEach(k => h[k] = data[k]);
// 	return h;
// };

// History.fromInfo = (info, op, from, to) => {
// 	let h = new History();
// 	h.hash = info.hash;
// 	h.op = op;
// 	h.from = from;
// 	h.to = to;
// 	h.amount = info.amount;
// 	h.timestamp = info.timestamp;
// 	return h;
// };

// Tx.History = History;

module.exports = Tx;