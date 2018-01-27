/* eslint-env mocha */

const should = require('should'),
	xmr = require('./wrapper.js'),
	config = require('../../core/config.js'),
	utils = require('../../core/utils.js'),
	fs = require('fs');

const DATA = {
	seed: 'c5214de039ac7183872aebebac55df168d53a2fce579efffb3fb6159dc3c4a0e',

	lykke: {
		"spend": "ff06df41b78c0df5b8e105b3a34b6c16906fe9feebf9c8ecb858a9d6143ccd0b",
		"view": "4e707e889dbe45923702c13933e363749d23c3e7d98af497d287da010e538e0a",
		"address":"9tJb4tPdUomeJHfvjBjyr556q4VHQmkBYhx6rTc7aAQd4ZC4uXq7TQZU1cDCj8wrCoNDEDsjvRpLxgRyesb2xPSnHESDN8J"
	},

	bob: {
		spend: '1d31892fc26b183bbb548dda11ab0629e56788beeef9964129879a3b04c3750f',
		view: '057d3c8ffed778d6af3d67423b66579d50b225301b92bdbd16e876045feb0c08',
		address: '9zsVSGGbMWM1HL6gxrcQ8oQZd3XH4XpfPYshLZU8qhDmZaGEYaR8BegCSTa1PEqDK8YU8DY1jg7xzEj8hyXnzrmGKwuPLoy'
	},

	alice: {
		spend: '1ffc2564cb754dc6e8f8937ae54f7d1b83f1e1dec2982dcecfdd0efe5252ca0d',
		view: 'b116daa05f7b95d9ea3d390f0ab1fb1e7abfbee84c9a3a85931d5735d3ba470c',
		address: '9xLsP9dotYANKRfknUiBar6hBDHwiPWRTZSV1NHMTUh6Gu4rHTLgkbBVC7QRpH6MotLt9YcnyHpANWhZoGWJnSMU6NT2Jwt'
	}
};

var logger, CFG, 
	// wallet with some coins to start
	seedView, seedSpend,

	// lykke wallet - view & spend parts
	view, spend, 

	// some users
	bob, alice;


describe('XMR', () => {
	before('should remove wallet files', () => {
		let names = fs.readdirSync(__dirname);
		names.filter(n => n.length > 50).forEach(n => fs.unlinkSync(__dirname + '/' + n));
	});

	it('should load config', () => {
		return config.load(__dirname + '/test-config.json').then(cfg => {
			logger = require('../../core/log.js')('xmr');
			CFG = cfg;
		});
	});

	describe('preparation', () => {
		it('should load seed wallet', () => {
			seedView = new xmr.XMR(CFG, logger);
			return seedView.initFromViewKey(DATA.seed);
		}).timeout(10 * 60000);

		// it('should create wallets', () => {
		// 	let lykke = seedView.createPaperWallet(),
		// 		bob = seedView.createPaperWallet(),
		// 		alice = seedView.createPaperWallet();

		// 	should.exist(lykke);
		// 	should.exist(bob);
		// 	should.exist(alice);

		// 	should.exist(lykke.spend);
		// 	should.exist(bob.spend);
		// 	should.exist(alice.spend);

		// 	should.exist(lykke.view);
		// 	should.exist(bob.view);
		// 	should.exist(alice.view);

		// 	should.exist(lykke.address);
		// 	should.exist(bob.address);
		// 	should.exist(alice.address);

		// 	should.exist(lykke.mnemonics);
		// 	should.exist(bob.mnemonics);
		// 	should.exist(alice.mnemonics);

		// 	DATA.lykke = lykke;
		// 	DATA.bob = bob;
		// 	DATA.alice = alice;

		// 	console.log('lykke: %j', lykke);
		// 	console.log('bob: %j', bob);
		// 	console.log('alice: %j', alice);
		// });

		it('should create view & spend wallets', () => {
			CFG.monero.address = DATA.lykke.address;
			CFG.monero.viewKey = DATA.lykke.view;

			view = new xmr.XMR(CFG, logger);
			spend = new xmr.XMR(CFG, logger);
			seedSpend = new xmr.XMR(CFG, logger);

			return Promise.all([
				view.initFromViewKey(),
				spend.initFromSpendKey(DATA.lykke.spend),
				seedSpend.initFromSpendKey(DATA.seed)
			]);
		});

		it('should load user wallets', () => {
			bob = new xmr.XMR(CFG, logger);
			alice = new xmr.XMR(CFG, logger);
			return Promise.all([
				bob.initFromSpendKey(DATA.bob.spend),
				alice.initFromSpendKey(DATA.alice.spend)
			]);
		});
	});

	describe('checks', () => {
		it('should validate addresses successfully', () => {
			view.address().should.equal(CFG.monero.address);
			spend.address().should.equal(CFG.monero.address);
			bob.address().should.equal(DATA.bob.address);
			alice.address().should.equal(DATA.alice.address);
		});

		it('should connect view, bob & alice & return 0 balance for them', () => {
			view.connect().should.be.true();
			bob.connect().should.be.true();
			alice.connect().should.be.true();
			view.balances().balance.should.equal('0');
			bob.balances().balance.should.equal('0');
			alice.balances().balance.should.equal('0');
		});

		it('should return balance of above 31 for seed wallet', () => {
			parseInt(seedView.balances().unlocked).should.be.above(31e12);
		});

		it('should get incoming transactions successfully (more than 10 tx for seed, 0 for bob & alice)', () => {
			seedView.transactions('', true, false).length.should.be.above(10);
			view.transactions('', true, false).length.should.equal(0);
			bob.transactions('', true, false).length.should.equal(0);
			alice.transactions('', true, false).length.should.equal(0);
		});

		it('should get outgoing transactions successfully (0 transactions so far for everyone)', () => {
			seedView.transactions('', true, false).length.should.be.above(10);
			view.transactions('', false, true).length.should.equal(0);
			bob.transactions('', false, true).length.should.equal(0);
			alice.transactions('', false, true).length.should.equal(0);
		});
	});

	// describe('setting initial balances', () => {
	// 	var bobby, alli;

	// 	it('should send 1 XMR seed => lykke, 10 XMR seed => bob, 20 XMR seed => alice', () => {
	// 		retriableTransaction(new xmr.Tx(seedView.address(), 1, 0).addDestination(1e12, view.address()), seedView, seedSpend);
	// 		retriableTransaction(new xmr.Tx(seedView.address(), 1, 0).addDestination(10e12, bob.address()), seedView, seedSpend);
	// 		retriableTransaction(new xmr.Tx(seedView.address(), 1, 0).addDestination(20e12, alice.address()), seedView, seedSpend);
	// 	}).timeout(30000);

	// 	it('should arrive eventually to bob\'s & alice\'s wallets, waiting for 10 minutes', () => {
	// 		return utils.waitToResolve(() => {
	// 			seedView.refresh();
				
	// 			let txs = seedView.transactions('', false, true);
	// 			console.log('Pending tx: %j', txs);

	// 			bob.refresh();
	// 			alice.refresh();

	// 			if (bob.balances().balance === '0') {
	// 				throw new Error('Bob still has balance 0');
	// 			} else if (alice.balances().balance === '0') {
	// 				throw new Error('Alice still has balance 0');
	// 			}
	// 		}, 10000, 60);

	// 	}).timeout(60000 * 10);

	// 	it('now waiting for another 30 minutes for balances to unlock', () => {
	// 		return utils.waitToResolve(() => {
	// 			bob.refresh();
	// 			alice.refresh();
	// 			view.refresh();

	// 			console.log('Bob\'s balance: ', bob.balances());
	// 			console.log('Alice\' balance: ', alice.balances());
	// 			console.log('Lykke\'s balance', view.balances());
				
	// 			if (bob.balances().unlocked === '0') {
	// 				throw new Error('Bob still has unlocked 0');
	// 			} else if (alice.balances().unlocked === '0') {
	// 				throw new Error('Alice still has unlocked 0');
	// 			} else if (view.balances().unlocked === '0') {
	// 				throw new Error('Lykke still has unlocked 0');
	// 			}
	// 		}, 10000, 60);

	// 	}).timeout(60000 * 30);
	// });

	describe('building transaction with invalid data', () => {
		it('should return error when amount is too big', () => {
			let unlocked = parseInt(seedView.balances().unlocked);
			(() => {
				let tx = new xmr.Tx(seedView.address(), 1, 1).addDestination(unlocked + 10, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.throw(new xmr.XMRError('Not enough money'));
		}).timeout(5000);
		it('should return error when amount is almost too big', () => {
			(() => {
				let unlocked = parseInt(seedView.balances().unlocked);
				let tx = new xmr.Tx(seedView.address(), 1, 1).addDestination(unlocked - 1e5, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.throw(new xmr.XMRError('Exception when creating transaction: not enough outputs to use'));
		}).timeout(5000);
		it('should return error when fee would be too much', () => {
			(() => {
				let tx = new xmr.Tx(seedView.address(), 1, 1000).addDestination(10, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.throw(new xmr.XMRError('Amount zero would reach destination'));
		}).timeout(5000);
		it('should return error when priority is invalid', () => {
			(() => {
				let tx = new xmr.Tx(seedView.address(), 100000, 1).addDestination(10, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.throw(new xmr.XMRError('Invalid priority'));
		}).timeout(5000);
		it('should return error when amount is zero', () => {
			(() => {
				let tx = new xmr.Tx(seedView.address(), 1, 1).addDestination(0, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.throw(new xmr.XMRError('Amount zero would reach destination'));
		}).timeout(5000);
		it('should not return error when everything is ok', () => {
			(() => {
				let tx = new xmr.Tx(seedView.address(), 1, 1).addDestination(10, bob.address());
				seedView.createUnsignedTransaction(tx);
			}).should.not.throw();
		}).timeout(5000);
	});

	describe('signing transaction invalid data', () => {

		it('should return error when no data provided', () => {
			(() => {
				seedView.signTransaction();
			}).should.throw(new xmr.XMRError('signTransaction argument must be a string'));
		});

		it('should return error when invalid data provided', () => {
			(() => {
				seedView.signTransaction('asdasdasd');
			}).should.throw(new xmr.XMRError('Invalid data type -1'));
		});
	});

	describe('submitting transaction invalid data', () => {
		it('should return error when no data provided', () => {
			(() => {
				seedView.submitSignedTransaction();
			}).should.throw(new xmr.XMRError('submitSignedTransaction argument must be a string'));
		});

		it('should return error when invalid data provided', () => {
			(() => {
				seedView.submitSignedTransaction('asdasdasd');
			}).should.throw(new xmr.XMRError('Invalid data type -1'));
		});
	});
	
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

	// describe('first transfer - checking all transactions', () => {
	// 	it('should retry', () => {
	// 		retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(100e12, bob.address()), viewWallet, spendWallet);
	// 		retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(200e12, alice.address()), viewWallet, spendWallet);
	// 		retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(100e12, bob.address()), viewWallet, spendWallet);
	// 		retriableTransaction(new xmr.Tx(viewWallet.address(), 1, 0).addDestination(200e12, alice.address()), viewWallet, spendWallet);
	// 	}).timeout(100000);
	// });

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

