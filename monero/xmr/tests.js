/* eslint-env mocha */

const should = require('should'),
	xmr = require('./wrapper.js'),
	config = require('../../core/config.js'),
	utils = require('../../core/utils.js'),
	fs = require('fs');

const DATA = {
	spend: 'c5214de039ac7183872aebebac55df168d53a2fce579efffb3fb6159dc3c4a0e',
	
	big: {
		spend: '462f85289b275a6a58af932fcec11660844a0b7485df27b9c095fa2c67ad020f',
		view: 'a66e4a83860b7589c12116ba95faedab187c7a69176fbbc0f5284141c64b3904',
		address: 'A1fCKqMJqD6RMP8TaKehoWWmbSa9hDMQviEh2hHQu9w6UTRvvUPL9CGhuNWiB3dG8618Z1cvLrNDgcaVjLibpBxNRA7Q67f'
	},

	bob: {
		spend: '9a42994747657aa2165e961e204eaa4efbbc4ed175eb0a5e88780b7574cfc005',
		view: '44bd0704d90b726aecbb535db29f891ed1e4189d41d40ff53a4140f876630204',
		address: '9wd2GoKLwnFE19ZSoHhASQBy8UAhsZ3JVD6w4sYV7tGTNr3G4gYxxKfHFQr9pH7gih9SFufiBe4v7XpVw5hBy4MWBkPKm75'
	},

	alice: {
		spend: '7ccd8e28b6fa7003b4e141606f18e3cdba4a22beab48f2e7a56ada32bae5cd08',
		view: '0f61a355ed98841413b95e87d11c8de8a2ae64b0f4524d0ce171c7c1afa45c0f',
		address: '9wYLTsMktzyTmtPNjWsMECfCCQ7ZtQLuTEMChN4G7rsnfo9Rgw7QuSvJCTuqA2gyUKbpgkS1eH25QgFdWMErYj1yMunJ7ey'
	}
};

var logger;

function retriableTransaction (tx, view, spend) {
	function attempt(outputs) {
		var result;
		if (outputs) {
			// result = view.exportOutputs();
			result = view.createUnsignedTransaction(tx);
			console.log('+++++ exportOutputs instead of createUnsignedTransaction: %j, error %s', Object.keys(result), result.error);
		} else {
			result = view.createUnsignedTransaction(tx);
			console.log('+++++ createUnsignedTransaction: %j, error %s', Object.keys(result), result.error);
		}
		result = spend.signTransaction(result.unsigned || result.outputs);
		console.log('+++++ signTransaction: %j, error %s', Object.keys(result), result.error);
		result = view.submitSignedTransaction(result.signed || result.keyImages);
		console.log('+++++ submitSignedTransaction: %j, tx %s, error %s', Object.keys(result), result.info ? result.info.id : 'nope',result.error);
		return result;
	}

	let arg;
	for (var i = 0; i < 3; i++) {
		console.log('================== attempt ' + i + ' =====================');
		let result = attempt(arg);
		if (result.info) {
			break;
		} else {
			arg = !!result.outputs;
		}
	}
}

describe('XMR', () => {
	before('should remove wallet files', () => {
		let names = fs.readdirSync(__dirname);
		names.filter(n => n.length > 50).forEach(n => fs.unlinkSync(__dirname + '/' + n));
	});

	var CFG, viewWallet, spendWallet, bob, alice;
	it('should load config', () => {
		return config.load(__dirname + '/test-config.json').then(cfg => {
			logger = require('../../core/log.js')('xmr');
			CFG = cfg;
		});
	});

	describe('preparation', () => {
		it('should load test-config.jsob viewWallet and start monitoring it', () => {
			viewWallet = new xmr.XMR(CFG, logger);
			return viewWallet.initFromViewKey();
		}).timeout(100000000); // for big blockchains rescan can take a while

		it('should create bob & alice', () => {
			let bob = viewWallet.createPaperWallet(),
				alice = viewWallet.createPaperWallet();

			should.exist(bob);
			should.exist(alice);

			should.exist(bob.spend);
			should.exist(alice.spend);

			should.exist(bob.view);
			should.exist(alice.view);

			should.exist(bob.address);
			should.exist(alice.address);

			should.exist(bob.mnemonics);
			should.exist(alice.mnemonics);

			DATA.bob.spend = bob.spend;
			DATA.bob.view = bob.view;
			DATA.bob.address = bob.address;

			DATA.alice.spend = alice.spend;
			DATA.alice.view = alice.view;
			DATA.alice.address = alice.address;

			console.log('bob: %j', bob);
			console.log('alice: %j', alice);
		});

		it('should load spend wallets', () => {
			spendWallet = new xmr.XMR(CFG, logger);
			bob = new xmr.XMR(CFG, logger);
			alice = new xmr.XMR(CFG, logger);
			return Promise.all([
				spendWallet.initFromSpendKey(DATA.spend),
				bob.initFromSpendKey(DATA.bob.spend),
				alice.initFromSpendKey(DATA.alice.spend)
			]);
		});
	});

	describe('checks', () => {
		it('should validate addresses successfully', () => {
			viewWallet.address().should.equal(CFG.monero.address);
			spendWallet.address().should.equal(CFG.monero.address);
			bob.address().should.equal(DATA.bob.address);
			alice.address().should.equal(DATA.alice.address);
		});

		it('should connect bob & alice & return 0 balance for them', () => {
			bob.connect().should.be.true();
			alice.connect().should.be.true();
			bob.balances().balance.should.equal('0');
			alice.balances().balance.should.equal('0');
		});

		it('should get incoming transactions successfully (more than 10 tx for viewWallet, 0 for bob & alice)', () => {
			viewWallet.transactions('', true, false).length.should.be.above(10);
			bob.transactions('', true, false).length.should.equal(0);
			alice.transactions('', true, false).length.should.equal(0);
		});

		it('should get outgoing transactions successfully (0 transactions so far for everyone)', () => {
			viewWallet.transactions('', false, true).length.should.equal(0);
			bob.transactions('', false, true).length.should.equal(0);
			alice.transactions('', false, true).length.should.equal(0);
		});
	});

	// describe('building transaction invalid data', () => {
	// 	it('should return error when amount is too big', () => {
	// 		let unlocked = parseInt(viewWallet.balances().unlocked);
	// 		(() => {
	// 			let tx = new xmr.Tx(viewWallet.address(), 1, 1).addDestination(unlocked + 10, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.throw(new xmr.XMRError('Not enough money'));
	// 	}).timeout(5000);
	// 	it('should return error when amount is almost too big', () => {
	// 		(() => {
	// 			let unlocked = parseInt(viewWallet.balances().unlocked);
	// 			let tx = new xmr.Tx(viewWallet.address(), 1, 1).addDestination(unlocked - 1e5, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.throw(new xmr.XMRError('Not enough outputs to use'));
	// 	}).timeout(5000);
	// 	it('should return error when fee would be too much', () => {
	// 		(() => {
	// 			let tx = new xmr.Tx(viewWallet.address(), 1, 1000).addDestination(10, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.throw(new xmr.XMRError('Amount zero would reach destination'));
	// 	}).timeout(5000);
	// 	it('should return error when priority is invalid', () => {
	// 		(() => {
	// 			let tx = new xmr.Tx(viewWallet.address(), 100000, 1).addDestination(10, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.throw(new xmr.XMRError('Invalid priority'));
	// 	}).timeout(5000);
	// 	it('should return error when amount is zero', () => {
	// 		(() => {
	// 			let tx = new xmr.Tx(viewWallet.address(), 1, 1).addDestination(0, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.throw(new xmr.XMRError('Amount zero would reach destination'));
	// 	}).timeout(5000);
	// 	it('should not return error when everything is ok', () => {
	// 		(() => {
	// 			let tx = new xmr.Tx(viewWallet.address(), 1, 1).addDestination(10, bob.address());
	// 			viewWallet.createUnsignedTransaction(tx);
	// 		}).should.not.throw();
	// 	}).timeout(5000);
	// });

	// describe('signing transaction invalid data', () => {
	// 	var spend;

	// 	it('should return error when no data provided', () => {
	// 		spend = new xmr.XMR(CFG);
	// 		spend.initFromSpendKey(DATA.spend);

	// 		(() => {
	// 			spend.signTransaction();
	// 		}).should.throw(new xmr.XMRError('signTransaction argument must be a string'));
	// 	});
	// 	it('should return error when invalid data provided', () => {
	// 		(() => {
	// 			spend.signTransaction('asdasdasd');
	// 		}).should.throw(new xmr.XMRError('Bad magic in unsigned tx data'));
	// 	});
	// });

	// describe('submitting transaction invalid data', () => {

	// 	it('should return error when no data provided', () => {
	// 		(() => {
	// 			viewWallet.submitSignedTransaction();
	// 		}).should.throw(new xmr.XMRError('submitSignedTransaction argument must be a string'));
	// 	});
	// 	it('should return error when invalid data provided', () => {
	// 		(() => {
	// 			viewWallet.submitSignedTransaction('asdasdasd');
	// 		}).should.throw(new xmr.XMRError('Bad magic in signed tx data'));
	// 	});
	// });
	
	
	// describe('refresh test', () => {
	// 	it('should only refresh once in a while', async () => {
	// 		let results = [];
	// 		for (var i = 0; i < 5 * 60000; i += 5000) {
	// 			results.push(viewWallet.refresh());
	// 			console.log(i + ' ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
	// 			await utils.wait(5000);
	// 			if (i > 0 && results[results.length - 1] === true) {
	// 				return;
	// 			}
	// 		}
	// 		throw new Error('No single block refresh is done');
	// 	}).timeout(5 * 60000 + 60000);
	// });

	describe('first transfer - checking all transactions', () => {
		it('should retry', () => {
			retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(100e12, bob.address()), viewWallet, spendWallet);
			retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(200e12, alice.address()), viewWallet, spendWallet);
			retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(100e12, bob.address()), viewWallet, spendWallet);
			retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(200e12, alice.address()), viewWallet, spendWallet);
		}).timeout(100000);
	});

	// describe('first transfer - checking all transactions', () => {
	// 	var hash;

	// 	it('should retrieve balances successfully', () => {
	// 		console.log(viewWallet.balances());
	// 	});

	// 	it('should send a simple 1 XMR transfer from viewWallet to bob', () => {
	// 		let tx = new xmr.Tx(viewWallet.address(), 1, 0).addDestination(1e12, bob.address());
	// 		let unsigned = viewWallet.createUnsignedTransaction(tx);
	// 		let signed = spendWallet.signTransaction(unsigned);
	// 		hash = viewWallet.submitSignedTransaction(signed);
	// 		should.exist(hash);
	// 		console.log(`Data length: ${unsigned.length} unsigned, ${signed.length} signed`);
	// 		console.log('Sent tx %j', hash);
	// 	}).timeout(30000);

	// 	it('should have this transaction in viewWallet outgoing list', () => {
	// 		let txs = viewWallet.transactions('', false, true);
	// 		txs.length.should.equal(1);
	// 		console.log('Pending tx: %j', txs);
	// 	});

	// 	it('should arrive eventually to bob\'s wallet, waiting for 10 minutes', () => {
	// 		let txs = viewWallet.transactions('', false, true);
	// 		txs.length.should.equal(1);
	// 		return utils.waitToResolve(() => {
	// 			viewWallet.refresh();
				
	// 			let txs = viewWallet.transactions('', false, true);
	// 			console.log('Pending tx: %j', txs);

	// 			bob.refresh();
	// 			if (bob.balances().balance === '0') {
	// 				throw new Error('Still balance 0');
	// 			} else if (txs.length === 0){
	// 				throw new Error('No transactions');
	// 			} else {
	// 				console.log('Bob\'s balance: %j', bob.balances());
	// 			}

	// 		}, 6000, 100);

	// 	}).timeout(60000 * 10);
	// });


	// describe('second transfer - checking single transaction', () => {
	// 	var hash;

	// 	it('should send a simple 2 XMR transfer from viewWallet to alice', () => {
	// 		let tx = new xmr.Tx(viewWallet.address(), 1, 0).addDestination(2e12, alice.address());
	// 		let unsigned = viewWallet.createUnsignedTransaction(tx);
	// 		let signed = spendWallet.signTransaction(unsigned);
	// 		hash = viewWallet.submitSignedTransaction(signed);
	// 		console.log(`Data length: ${unsigned.length} unsigned, ${signed.length} signed`);
	// 		console.log('Sent tx %j', hash);
	// 		should.exist(hash);
	// 	}).timeout(30000);

	// 	it('should have 2 transactions now in viewWallet outgoing list', () => {
	// 		let txs = viewWallet.transactions('', false, true);
	// 		console.log('Pending tx: %j', txs);
	// 		txs.length.should.equal(2);
	// 	});

	// 	it('should have 1 transaction if looking by id', () => {
	// 		let txs = viewWallet.transactions(hash.id);
	// 		console.log('Pending tx: %j', txs);
	// 		txs.length.should.equal(1);
	// 	});

	// 	it('should have 1 transaction if looking by id & outgoing filter', () => {
	// 		let txs = viewWallet.transactions(hash.id, false, true);
	// 		console.log('Pending tx: %j', txs);
	// 		txs.length.should.equal(1);
	// 	});

	// 	it('should arrive eventually to alice\'s wallet, waiting for 10 minutes', () => {
	// 		return utils.waitToResolve(() => {
	// 			viewWallet.refresh();

	// 			let txs = viewWallet.transactions(hash.id, false, true);
	// 			console.log('Pending tx: %j', txs);

	// 			alice.refresh();
	// 			if (alice.balances().balance === '0') {
	// 				throw new Error('Still balance 0');
	// 			} else if (txs.length === 0){
	// 				throw new Error('No transactions');
	// 			} else {
	// 				console.log('Alice\'s balance: %j', alice.balances());
	// 			}

	// 		}, 6000, 100);

	// 	}).timeout(60000 * 10);
	// });

	// describe('load simulation', () => {
	// 	var transfers = [...Array(100).keys()], wait = transfers.length * 60000;

	// 	it('should send ' + transfers.length + ' transactions', () => {
	// 		transfers = transfers.map(i => {
	// 			return {to: Math.random() > .5 ? DATA.bob.address : DATA.alice.address, amount: .1e12 * (i + 1)};
	// 		});

	// 		console.log('tranfers: %j', transfers);

	// 		return utils.promiseSerial(transfers.map(t => {
	// 			return () => {
	// 				return new Promise(resolve => {
	// 					console.log('sending %j (%d)', t, t.amount / 1e12);
	// 					let tx = new xmr.Tx(viewWallet.address(), 1, 0).addDestination(t.amount, t.to);
	// 					let unsigned = viewWallet.createUnsignedTransaction(tx);
	// 					let signed = spendWallet.signTransaction(unsigned);
	// 					let info = viewWallet.submitSignedTransaction(signed);
	// 					console.log(`Data length: ${unsigned.length} unsigned, ${signed.length} signed`);
	// 					console.log('Sent tx %j', info);
	// 					should.exist(info);
	// 					t.id = info.id;
	// 					resolve(t.id);
	// 				});
	// 			};
	// 		}));
	// 	}).timeout(10000 * transfers.length);

	// 	it('should have no unconfirmed transactions eventually, waiting for ' + wait + 'ms', () => {
	// 		let ids = transfers.map(t => t.id);

	// 		return utils.waitToResolve(() => {
	// 			viewWallet.refresh();

	// 			let all = viewWallet.transactions('', false, true),
	// 				txs = all.filter(t => ids.indexOf(t.id) !== -1),
	// 				pending = txs.filter(t => t.state === 'pending').length,
	// 				failed = txs.filter(t => t.state === 'failed').length;
				
	// 			console.log('Pending tx: %d out of %d, failed %d, others %d', pending, txs.length, failed, all.length - txs.length);

	// 			if (txs.length === 0){
	// 				throw new Error('No transactions');
	// 			} else if (pending > 0) {
	// 				throw new Error('Still ' + pending + ' transactions');
	// 			}

	// 		}, 10000, wait / 10000);

	// 	}).timeout(wait);
	// });


	after(() => {
		let names = fs.readdirSync(__dirname);
		names.filter(n => n.length > 50).forEach(n => fs.unlinkSync(__dirname + '/' + n));
	});

	// var hash;
	// it('should create unsigned transaction', () => {
	// 	let tx = new xmr.Tx(viewWallet.address()).addDestination(1e12, bob.address()).addDestination(2e12, alice.address());
	// 	let unsigned = viewWallet.createUnsignedTransaction(tx);
	// 	let signed = spendWallet.signTransaction(unsigned);
	// 	hash = viewWallet.submitSignedTransaction(signed);
	// 	hash.charAt(0).should.not.equal('-');
	// });
});

