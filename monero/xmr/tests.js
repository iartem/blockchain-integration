/* eslint-env mocha */

const should = require('should'),
	Wallet = require('./wrapper.js'),
	config = require('../../core/config.js'),
	utils = require('../../core/utils.js'),
	fs = require('fs');

const DATA = {
	seed: 'c5214de039ac7183872aebebac55df168d53a2fce579efffb3fb6159dc3c4a0e',

	// lykke: {
	// 	spend: "c33bd5fc633f6fb810cae11f0bc9014f21abbabc3afba176f3f9d037a74da800",
	// 	view: "4a4016a0541e79b2da92ad674058abc76657837a4ad8be3b37e40d965adb010c",
	// 	address: "9xhKLBE5CPGH7X3cpToP7mReyxSiWeXqqYFBQJPW7QcqZkMuwR5QejBFWVjx8DUC1PJkkFTPFpGPsWvvXRRcVdFAP8TQ97Y",
	// 	mnemonics: "galaxy ridges refer nuisance waffle polar examine nouns regular chlorine long stellar soapy inbound ceiling imagine down potato spud abbey duckling lakes peculiar pelican potato"
	// },

	// bob: {
	// 	spend: "8502e1c126ee851d6d47b1eef7ff771c78aacde2338ed9f972822176313eec01",
	// 	view: "ecb786799e24a5a6523af947e037c4cc4621d6bbd0f0c2d0526b839ce50f2b06",
	// 	address: "A2ST8watxEDc6PHXQ1WVwoiJdBwESnz7N42KrQP38PucJX5VLkLFZ6kWssw5vYRuctXLDGpZDf8bcZ4MtBbVquroHTcasZq",
	// 	mnemonics: "occur unfit pests reduce annoyed costume unrest neutral lofty chlorine sowed upwards vivid criminal anxiety emails revamp queen goes when italics truth auctions awkward emails"
	// },

	// alice: {
	// 	spend: "926a0fc37bf9c4f5f4f15316df27c7c84c3b5d4d93538b0f3c36ea4413ab5303",
	// 	view: "1734fac76955deef19c8a9d4fb1e8988fc3e7ffb9e30423a0949b2a8e01c3906",
	// 	address: "9vaoBWVJGAobdkhpAMC9wD9itF9g4B1LDVpcuF4nYu93Y2AFqJ8iKa6ZHne6wSnyxibbAJSHgN4doJG47fM8e158BonEsV2",
	// 	mnemonics: "beware unhappy pierce hawk vivid until inline benches dehydrate deepest erase ammo reruns pawnshop vivid vane nearby ostrich bimonthly invoke pyramid mechanic palace perfect mechanic"
	// }

	lykke: {
		spend: "20b5e7b349c9ec34cf270005a811a46221e5abac24f939a9ff8eb5663dc0a002", 
		view: "6d9bd10e676bcc56681010a39515083dfc77e62ad1cb366948abda8b3334fd0a",
		address: "A1FMChdRFVHVB9NB3mWWJecYgNpX8uTeW7zUZHiYFYK1Gs78rCfEndMF7CXTbRUHVKVV9QDBZWgMU6SRDNpBiuPXUnvHm5y",
		mnemonics: "fabrics unjustly obvious inkling equip kisses riots jump lamb rockets polar apology under online feel zesty tiger luxury acumen shyness custom enough velvet vipers fabrics"
	},

	bob: {
		spend: "293526ef2cbb9eccd33c388564910682aee6fa755f379c4692c0b1f502358d04", 
		view: "230e50b2b217791c79a7b398cfc42f022945b96f56757e4092ba4a2f0372a000",
		address: "9uLcf1WhdGZ5WeJiWEB7b73pFWfBra8vKPF8inkVTJGdajJgts9phtfbE2AnxtWdo2XZWNak5YhLn9kLRNHLcaYXLPG1HNt",
		mnemonics: "reunion faxed drowning economics pylons lexicon serving bypass piano muzzle pierce copy eagle unfit guarded poverty salads against online renting point rigid ointment origin rigid"
	},

	alice: {
		spend: "d9df52fdcdb38935680b3d7ddef0fac52aa7cb0e6ec6605e60265a8b83510904", 
		view: "0344b714b3b57d2daa0c6024aa44b89cff249cf0476137fbd5aca37f505cce06",
		address: "9sfuSQSxxLwf8xXvTCTsNbdqUYPci3ZySDmZKzfv2kvacaEW8oZEJBTa19Ram7P4xve9TcUh1j6FacfgSvx6XnTSSDn6HLg",
		mnemonics: "feel sonic smash value pimple torch skew lottery zeal bluntly jaunt donuts magically ignore kettle awkward wives goat certain jailed woes vitals nabbing nibs nibs"
	}
};

var logger, CFG, 
	// wallet with some coins to start
	seedView, seedSpend,

	// lykke wallet - view & spend parts
	view, spend, 

	// some users
	bob, alice;

// array of calls of seedView wallet onTx callbacks
var seedViewOnTx = [];

describe('XMR', () => {
	// before('should remove wallet files', () => {
	// 	let names = fs.readdirSync(__dirname);
	// 	names.filter(n => n.length > 50 || n === '.new').forEach(n => fs.unlinkSync(__dirname + '/' + n));
	// });

	it('should load config', () => {
		return config.load(__dirname + '/test-config.json').then(cfg => {
			logger = require('../../core/log.js')('xmr');
			CFG = cfg;
		});
	});

	describe('preparation', () => {
		it('should load seed wallet', () => {
			seedView = new Wallet(CFG.testnet, CFG.node, logger, (info) => {
				seedViewOnTx.push(info);
				console.log('onTx %j', info);
			}, 10000);
			return seedView.initViewWallet(CFG.monero.address, CFG.monero.viewKey).then((ret) => {
				console.log('--------------');
				return ret;
			});
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
			view = new Wallet(CFG.testnet, CFG.node, logger, () => console.log.bind(console, 'onTx'), 10000);
			spend = new Wallet(CFG.testnet, CFG.node, logger, () => console.log.bind(console, 'onTx'), 10000);
			seedSpend = new Wallet(CFG.testnet, CFG.node, logger, () => console.log.bind(console, 'onTx in seedSpend'), 10000);
			bob = new Wallet(CFG.testnet, CFG.node, logger, () => console.log.bind(console, 'onTx in bob spend'), 10000);
			alice = new Wallet(CFG.testnet, CFG.node, logger, () => console.log.bind(console, 'onTx in alice spend'), 10000);

			return Promise.all([
				view.initViewWallet(DATA.lykke.address, DATA.lykke.view),
				spend.initSignWallet(DATA.lykke.address, DATA.lykke.spend),
				seedSpend.initSignWallet(CFG.monero.address, DATA.seed),
				bob.initSignWallet(DATA.bob.address, DATA.bob.spend),
				alice.initSignWallet(DATA.alice.address, DATA.alice.spend)
			]);
		}).timeout(10 * 60000);

		it('should connect & refresh required wallets', () => {
			bob.connect().should.be.true();
			alice.connect().should.be.true();
			bob.refresh();
			alice.refresh();
		}).timeout(2 * 60000);

		it('should print balances', () => {
			console.log('view %j', view.balance);
			console.log('bob %j', bob.balance);
			console.log('alice %j', alice.balance);
			console.log('seedView %j', seedView.balance);
		});
	});

	// describe('checks', () => {
		// it('should validate addresses successfully', () => {
		// 	view.address().should.equal(CFG.monero.address);
		// 	spend.address().should.equal(CFG.monero.address);
		// 	bob.address().should.equal(DATA.bob.address);
		// 	alice.address().should.equal(DATA.alice.address);
		// });

		// it('should connect view, bob & alice & return 0 balance for them', () => {
		// 	view.connect().should.be.true();
		// 	bob.connect().should.be.true();
		// 	alice.connect().should.be.true();
		// 	view.balance.balance.should.equal('0');
		// 	bob.balance.balance.should.equal('0');
		// 	alice.balance.balance.should.equal('0');
		// });

		// it('should return balance of above 31 for seed wallet', () => {
		// 	parseInt(seedView.balance.unlocked).should.be.above(31e12);
		// });

		// it('should get incoming transactions successfully (more than 10 tx for seed, 0 for bob & alice)', () => {
		// 	seedView.transactions('', true, false).length.should.be.above(10);
		// 	view.transactions('', true, false).length.should.equal(0);
		// 	bob.transactions('', true, false).length.should.equal(0);
		// 	alice.transactions('', true, false).length.should.equal(0);
		// });

		// it('should get outgoing transactions successfully (0 transactions so far for everyone)', () => {
		// 	seedView.transactions('', true, false).length.should.be.above(10);
		// 	view.transactions('', false, true).length.should.equal(0);
		// 	bob.transactions('', false, true).length.should.equal(0);
		// 	alice.transactions('', false, true).length.should.equal(0);
		// });
	// });

	// describe('setting initial balances', () => {
	// 	var bobby, alli;

	// 	it('should send 1 XMR seed => lykke, 10 XMR seed => bob, 20 XMR seed => alice', () => {
	// 		retriableTransaction(new Wallet.Tx(seedView.address(), 1, 0).addDestination(1e12, view.address()), seedView, seedSpend);
	// 		retriableTransaction(new Wallet.Tx(seedView.address(), 1, 0).addDestination(10e12, bob.address()), seedView, seedSpend);
	// 		retriableTransaction(new Wallet.Tx(seedView.address(), 1, 0).addDestination(20e12, alice.address()), seedView, seedSpend);
	// 	}).timeout(30000);

	// 	it('should arrive eventually to bob\'s & alice\'s wallets, waiting for 10 minutes', () => {
	// 		return utils.waitToResolve(() => {
	// 			seedView.refresh();
				
	// 			let txs = seedView.transactions('', false, true);
	// 			console.log('Pending tx: %j', txs);

	// 			bob.refresh();
	// 			alice.refresh();

	// 			if (bob.balance.balance === '0') {
	// 				throw new Error('Bob still has balance 0');
	// 			} else if (alice.balance.balance === '0') {
	// 				throw new Error('Alice still has balance 0');
	// 			}
	// 		}, 10000, 60);

	// 	}).timeout(60000 * 10);

	// 	it('now waiting for another 30 minutes for balances to unlock', () => {
	// 		return utils.waitToResolve(() => {
	// 			bob.refresh();
	// 			alice.refresh();
	// 			view.refresh();

	// 			console.log('Bob\'s balance: ', bob.balance);
	// 			console.log('Alice\' balance: ', alice.balance);
	// 			console.log('Lykke\'s balance', view.balance);
				
	// 			if (bob.balance.unlocked === '0') {
	// 				throw new Error('Bob still has unlocked 0');
	// 			} else if (alice.balance.unlocked === '0') {
	// 				throw new Error('Alice still has unlocked 0');
	// 			} else if (view.balance.unlocked === '0') {
	// 				throw new Error('Lykke still has unlocked 0');
	// 			}
	// 		}, 10000, 60);

	// 	}).timeout(60000 * 30);
	// });

	// describe('building transaction with invalid data', () => {
	// 	it('should return error when amount is too big', () => {
	// 		let unlocked = parseInt(seedView.balance.unlocked);
	// 		let tx = new Wallet.Tx('id', 1, 1).addDestination(unlocked + 10, bob.address());
	// 		let result = seedView.createUnsignedTransaction(tx);
	// 		should.exist(result.error);
	// 		should.exist(result.error.type);
	// 		result.error.type.should.equal(Wallet.Errors.NOT_ENOUGH_FUNDS);
	// 	}).timeout(10000);
	// 	it('should return error when amount is almost too big', () => {
	// 		let unlocked = parseInt(seedView.balance.unlocked);
	// 		console.log('balance', unlocked, unlocked - 10);
	// 		let tx = new Wallet.Tx('id', 1, 1).addDestination(unlocked - 10, bob.address());
	// 		let result = seedView.createUnsignedTransaction(tx);
	// 		should.exist(result.error);
	// 		should.exist(result.error.type);
	// 		result.error.type.should.equal(Wallet.Errors.NOT_ENOUGH_OUTPUTS);
	// 	}).timeout(10000);
	// 	it('should return error when priority is invalid', () => {
	// 		(() => {
	// 			let tx = new Wallet.Tx('id', 100000, 1).addDestination(10, bob.address());
	// 			let result = seedView.createUnsignedTransaction(tx);
	// 			should.exist(result.error);
	// 			should.exist(result.error.type);
	// 			result.error.type.should.equal(Wallet.Errors.NOT_ENOUGH_AMOUNT);
	// 		}).should.throw(new Wallet.Error(Wallet.Errors.VALIDATION, 'Invalid priority'));
	// 	}).timeout(10000);
	// 	it('should return error when amount is zero', () => {
	// 		let tx = new Wallet.Tx('id', 1, 1).addDestination(0, bob.address());
	// 		let result = seedView.createUnsignedTransaction(tx);
	// 		should.exist(result.error);
	// 		should.exist(result.error.type);
	// 		result.error.type.should.equal(Wallet.Errors.NOT_ENOUGH_AMOUNT);
	// 	}).timeout(10000);
	// 	it('should not return error when everything is ok', () => {
	// 		let tx = new Wallet.Tx('id', 1, 1).addDestination(10, bob.address());
	// 		let result = seedView.createUnsignedTransaction(tx);
	// 		should.not.exist(result.error);
	// 		should.exist(result.unsigned);
	// 	}).timeout(10000);
	// });

	// describe('signing transaction invalid data', () => {
	// 	it('should return error when no data provided', () => {
	// 		(() => {
	// 			seedView.signTransaction();
	// 		}).should.throw(new Wallet.Error(Wallet.Errors.VALIDATION, 'signTransaction argument must be a string'));
	// 	});

	// 	it('should return error when invalid data provided', () => {
	// 		let result = seedView.signTransaction('asdasdasd');
	// 		should.exist(result.error);
	// 		should.exist(result.error.type);
	// 		result.error.type.should.equal(Wallet.Errors.EXCEPTION, 'Invalid data type -1');
	// 	});
	// });

	// describe('submitting transaction invalid data', () => {
	// 	it('should return error when no data provided', () => {
	// 		(() => {
	// 			seedView.submitSignedTransaction();
	// 		}).should.throw(new Wallet.Error(Wallet.Errors.VALIDATION, 'submitSignedTransaction argument must be a string'));
	// 	});

	// 	it('should return error when invalid data provided', () => {
	// 		let result = seedView.submitSignedTransaction('asdasdasd');
	// 		should.exist(result.error);
	// 		should.exist(result.error.type);
	// 		result.error.type.should.equal(Wallet.Errors.EXCEPTION, 'Invalid data type -1');
	// 	});
	// });
	
	// describe('auto refresh test', () => {
	// 	it('should refresh automatically once in a while', async () => {
	// 		let height = seedView.height;
	// 		for (var i = 0; i < 5 * 60000; i += 5000) {
	// 			await utils.wait(5000);
	// 			if (seedView.height !== height) {
	// 				return;
	// 			}
	// 		}
	// 		throw new Error('No refresh is done in 6 minutes');
	// 	}).timeout(5 * 60000 + 60000);
	// });







	describe('checking all transactions', () => {
		var T1, T2, T3;
		// it('should send 10 to bob, 20 to alice & 30 XMR to lykke', async () => {
		// 	// bob.connect().should.be.true();
		// 	// retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(1e12, seedView.address()), bob, bob);
		// 	// initialOnTx = seedViewOnTx.length;
		// 	T1 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(10e12, bob.address()), seedView, seedSpend);
		// 	should.exist(T1);

		// 	T2 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(20e12, alice.address()), seedView, seedSpend);
		// 	should.exist(T2);

		// 	T3 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(100e12, view.address()), seedView, seedSpend);
		// 	should.exist(T3);

		// 	// retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(4e12, alice.address()), viewWallet, spendWallet);
		// 	// should.exist(tx.info);
		// 	// T4 = tx.info.id;
		// 	while (true) {
		// 		let t1 = seedView.transactions(T1, false, true),
		// 			t2 = seedView.transactions(T2, false, true),
		// 			t3 = seedView.transactions(T3, false, true);

		// 		console.log(`>>>>>>>>>>> T1 ${t1.length && t1[0].state} T2 ${t2.length && t2[0].state} T3 ${t3.length && t3[0].state}`);
		// 		if (t1.length && t2.length && t3.length && t1[0].state === 'confirmed' && t2[0].state === 'confirmed' && t3[0].state === 'confirmed') {
		// 			bob.refresh();
		// 			alice.refresh();
		// 			view.refresh();

		// 			if (bob.balance.unlocked !== '0' && alice.balance.unlocked !== '0' && view.balance.unlocked !== '0') {
		// 				console.log('bob %j', bob.balance);
		// 				console.log('alice %j', alice.balance);
		// 				console.log('view %j', view.balance);
		// 				seedView.close();
		// 				seedView = null;
		// 				seedSpend.close();
		// 				seedSpend = null;
		// 				return;
		// 			}
		// 		}

		// 		if ((t1.length && t1[0].state === 'failed') || (t2.length && t2[0].state === 'failed') || (t3.length && t3[0].state === 'failed')) {
		// 			throw new Error('One of txs failed');
		// 		}

		// 		await utils.wait(30000);
		// 	}
		// }).timeout((2.5 * 10 + 3) * 60000);

		it('should transfer between from bob & alice to lykke', async () => {
			var T4, T5, T6, T7, A6, A7, P6, P7;

			T4 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(1e11, bob.address()), view, spend);
			should.exist(T4);

			T5 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(2e11, alice.address()), view, spend);
			should.exist(T5);

			A6 = view.addressCreate();
			A7 = view.addressCreate();
			P6 = view.addressDecode(A6).paymentId;
			P7 = view.addressDecode(A7).paymentId;
			console.log(`created address A6 ${A6} (payment id ${P6}), A7 ${A7} (payment id ${P7})`);

			view.onTx = (tx) => {
				if (tx.payment_id === P6) {
					console.log('>>> P6 view onTx %j', tx);
					T6 = tx.id;
				} else if (tx.payment_id === P7) {
					console.log('>>> P7 view onTx %j', tx);
					T7 = tx.id;
				} else {
					console.log('random view onTx %j', tx);
				}
			};

			console.log(`send 0.33 XMR to ${A6}, .44 XMR to ${A7}`);
			await utils.wait(30000);

			// T6 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(3.3e11, A6), bob, bob);
			// should.exist(T6);

			// T7 = await retriableTransaction(new Wallet.Tx('id', 1, 0).addDestination(4.4e11, A7), alice, alice);
			// should.exist(T7);

			while (true) {
				let t4 = view.transactions(T4, false, true),
					t5 = view.transactions(T5, false, true),
					t6 = T6 ? view.transactions(T6, true, false) : [],
					t7 = T7 ? view.transactions(T7, true, false) : [];

				console.log(`>>>>>>>>>>> T4 ${t4.length && t4[0].state} T5 ${t5.length && t5[0].state} T6 ${t6.length && t6[0].state} T7 ${t7.length && t7[0].state}`);
				console.log(`>>>>>>>>>>> T6 lock ${t6.length && t6[0].lock} T7 lock ${t7.length && t7[0].lock}`);
				if (t4.length && t5.length && t6.length && t7.length && t4[0].state === 'confirmed' && t5[0].state === 'confirmed' && t6[0].state === 'confirmed' && t7[0].state === 'confirmed' &&
					!t6[0].lock && !t7[0].lock) {
					return;
				}

				if ((t4.length && t4[0].state === 'failed') || (t5.length && t5[0].state === 'failed') || (t6.length && t6[0].state === 'failed') || (t7.length && t7[0].state === 'failed')) {
					throw new Error('One of txs failed');
				}

				await utils.wait(30000);
			}
		}).timeout((2.5 * 10 + 3) * 60000);
	});












	// describe('first transfer - checking all transactions', () => {
	// 	var hash;

	// 	it('should retrieve balances successfully', () => {
	// 		console.log(viewWallet.balance);
	// 	});

	// 	it('should send a simple 1 XMR transfer from viewWallet to bob', () => {
	// 		let tx = new Wallet.Tx(viewWallet.address(), 1, 0).addDestination(1e12, bob.address());
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
	// 			if (bob.balance.balance === '0') {
	// 				throw new Error('Still balance 0');
	// 			} else if (txs.length === 0){
	// 				throw new Error('No transactions');
	// 			} else {
	// 				console.log('Bob\'s balance: %j', bob.balance);
	// 			}

	// 		}, 6000, 100);

	// 	}).timeout(60000 * 10);
	// });


	// describe('second transfer - checking single transaction', () => {
	// 	var hash;

	// 	it('should send a simple 2 XMR transfer from viewWallet to alice', () => {
	// 		let tx = new Wallet.Tx(viewWallet.address(), 1, 0).addDestination(2e12, alice.address());
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
	// 			if (alice.balance.balance === '0') {
	// 				throw new Error('Still balance 0');
	// 			} else if (txs.length === 0){
	// 				throw new Error('No transactions');
	// 			} else {
	// 				console.log('Alice\'s balance: %j', alice.balance);
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
	// 					let tx = new Wallet.Tx(viewWallet.address(), 1, 0).addDestination(t.amount, t.to);
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
		if (seedView) { seedView.close(); }
		if (seedSpend) { seedSpend.close(); }
		if (view) { view.close(); }
		if (spend) { spend.close(); }
		if (bob) { bob.close(); }
		if (alice) { alice.close(); }
		// let names = fs.readdirSync(__dirname);
		// names.filter(n => n.length > 50 || n === '.new').forEach(n => fs.unlinkSync(__dirname + '/' + n));
	});

	// var hash;
	// it('should create unsigned transaction', () => {
	// 	let tx = new Wallet.Tx(viewWallet.address()).addDestination(1e12, bob.address()).addDestination(2e12, alice.address());
	// 	let unsigned = viewWallet.createUnsignedTransaction(tx);
	// 	let signed = spendWallet.signTransaction(unsigned);
	// 	hash = viewWallet.submitSignedTransaction(signed);
	// 	hash.charAt(0).should.not.equal('-');
	// });
});

async function retriableTransaction (tx, view, spend) {
	function attempt(resync) {
		var result;
		if (resync) {
			result = view.constructFullSyncData();
			console.log('+++++ constructFullSyncData: %j, error %s', Object.keys(result), result.error);
		} else {
			result = view.createUnsignedTransaction(tx);
			console.log('+++++ createUnsignedTransaction: %j, error %s', Object.keys(result), result.error);
			if (result.error && result.error.type === Wallet.Errors.NOT_ENOUGH_FUNDS) {
				result = view.constructFullSyncData();
				console.log('+++++ not enough funds, constructFullSyncData: %j, error %s', Object.keys(result), result.error);
			}
		}

		result = spend.signTransaction(result.unsigned || result.outputs);
		console.log('+++++ signTransaction: %j, error %s', Object.keys(result), result.error);
		result = view.submitSignedTransaction(result.signed || result.keyImages);
		console.log('+++++ submitSignedTransaction: %j, tx %s, error %s', Object.keys(result), result.info ? result.info.id : 'nope', result.error);
		return result;
	}

	let arg;
	for (var i = 0; i < 4; i++) {
		console.log('================== attempt ' + i + ' =====================');
		let result = attempt(arg);
		if (result.info) {
			console.log('Submitted tx %j', result);
			return result.info.id;
		} else {
			arg = result.error && (result.error.type === Wallet.Errors.SYNC_REQUIRED || result.error.type === Wallet.Errors.RETRY_REQUIRED);
		}

		// resync needed
		if (i === 1) {
			await utils.wait(4 * 60000);
		}
	}
}

// function retriableTransaction (tx, view, spend) {
// 	function attempt(outputs) {
// 		var result;
// 		if (outputs) {
// 			// result = view.exportOutputs();
// 			result = view.createUnsignedTransaction(tx);
// 			console.log('+++++ exportOutputs instead of createUnsignedTransaction: %j, error %s', Object.keys(result), result.error);
// 		} else {
// 			result = view.createUnsignedTransaction(tx);
// 			console.log('+++++ createUnsignedTransaction: %j, error %s', Object.keys(result), result.error);
// 		}
// 		result = spend.signTransaction(result.unsigned || result.outputs);
// 		console.log('+++++ signTransaction: %j, error %s', Object.keys(result), result.error);
// 		result = view.submitSignedTransaction(result.signed || result.keyImages);
// 		console.log('+++++ submitSignedTransaction: %j, tx %s, error %s', Object.keys(result), result.info ? result.info.id : 'nope',result.error);
// 		return result;
// 	}

// 	let arg;
// 	for (var i = 0; i < 3; i++) {
// 		console.log('================== attempt ' + i + ' =====================');
// 		let result = attempt(arg);
// 		if (result.info) {
// 			break;
// 		} else {
// 			arg = !!result.outputs;
// 		}
// 	}
// }

