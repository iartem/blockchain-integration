/* eslint-env mocha */

const should = require('should'),
	nock = require('nock'),
	Wallet = require('./wallet.js'),
	Log = require('../core/log.js'),
	crypto = require('crypto'),
	supertest = require('supertest'),
	config = require('../core/config.js'),
	Transport = require('../core/transport.js'),
	utils = require('../core/utils.js');

var CFG, createWallet = () => new Wallet(CFG.testnet, CFG.node, Log('wallet'), () => console.log.bind(console, 'onTx'));

// describe('wallet', function() {
// 	// let W1 = {"address":"GCONF2CUHQNACHNJJRPH6F77FN5U5JCHBRKB346QE2SESBHAXDLTDDIW","seed":"SADL44IUHWTFDOPMIQ44L66LLFIWGYQXYWALSE7XP5ZGSZG6OI6RISW3"};
// 	// let W2 = {"address":"GDMSHZUMPFQ37BUAETLOMAF3JCUG53OVDPIYYXLQBC3C5MFUUHRX7CYO","seed":"SAAYDPMOOTQ22E2KL2X7EA4EZIRRPEXGOX4G4CMRXG2OBBMF55R7BYYE"};
// 	// let W3 = {"address":"GBB6PYWFBSNG7RBT3I5IKBZ4UJ4Y55VKDBKQRDWIPVIG54OMLKKZO2AW","seed":"SAAXIZX25T36RTRXLPTTBHEPJHTLEB27VSBMTABLW7NKPLTAIKZPN3CD"};
// 	let W1, W2, W3;

// 	it('should load config', async () => {
// 		CFG = await require('../core/config.js').load(__dirname + '/test-config.json');
// 	});
	
// 	it('should generate 3 new wallets', async () => {
// 		let wallet = createWallet();
// 		W1 = await wallet.createPaperWallet();
// 		W2 = await wallet.createPaperWallet();
// 		W3 = await wallet.createPaperWallet();
// 		console.log('W1 %j', W1);
// 		console.log('W2 %j', W2);
// 		console.log('W3 %j', W3);
// 	}).timeout(60000);

// 	it('should create & parse addresses', async () => {
// 		let wallet = createWallet();
// 		await wallet.initSignWallet(W1.address, W1.seed);

// 		let address = wallet.addressCreate();
// 		should.exist(address);

// 		let parsed = wallet.addressDecode(address);
// 		should.exist(parsed);
// 		should.exist(parsed.address);
// 		should.exist(parsed.paymentId);

// 		(parsed.address + '|' + parsed.paymentId).should.equal(address);
// 	});
	
// 	it('should open view wallet successfully', async () => {
// 		let wallet = createWallet();
// 		try {
// 			await wallet.initViewWallet(W1.address);
// 			wallet.status.should.equal(Wallet.Status.Ready);
// 			should.exist(wallet.balance);
// 			should.exist(wallet.balance.native);
// 		} finally {
// 			await wallet.close();
// 		}
// 	}).timeout(10000);

// 	it('should open sign wallet successfully', async () => {
// 		let wallet = createWallet();
// 		try {
// 			await wallet.initSignWallet(W1.address, W1.seed);
// 			wallet.status.should.equal(Wallet.Status.Ready);
// 		} finally {
// 			await wallet.close();
// 		}
// 	}).timeout(10000);

// 	it('should create & sign transaction W1 => W2', async () => {
// 		let w1view = createWallet(), w1sign = createWallet(), w2 = createWallet();

// 		try {
// 			await w1view.initViewWallet(W1.address);
// 			await w1sign.initSignWallet(W1.address, W1.seed);
// 			await w2.initViewWallet(W2.address);

// 			w1view.status.should.equal(Wallet.Status.Ready);
// 			w1sign.status.should.equal(Wallet.Status.Ready);
// 			w2.status.should.equal(Wallet.Status.Ready);

// 			let w1initial = w1view.balance.native,
// 				w2initial = w2.balance.native;

// 			let addr = w2.addressDecode(w2.addressCreate());
// 			let tx = new Wallet.Tx('id', 1, 0);
// 			tx.addPayment(W1.address, addr.address, 'native', 1e7, undefined, addr.paymentId);
// 			let unsigned = await w1view.createUnsignedTransaction(tx);
// 			console.log('unsigned', unsigned);
// 			should.exist(unsigned);
// 			should.exist(unsigned.unsigned);
// 			should.not.exist(unsigned.error);

// 			let signed = w1sign.signTransaction(unsigned.unsigned);
// 			console.log('signed', signed);
// 			should.exist(signed);
// 			should.exist(signed.signed);
// 			should.not.exist(signed.error);

// 			let sent = await w1view.submitSignedTransaction(signed.signed);
// 			console.log('sent', sent);
// 			console.log(sent);

// 			let onTxCalled = false;
// 			w2.onTx = payment => {
// 				onTxCalled = true;
// 			};

// 			await utils.waitToResolve(async () => {
// 				let w1after = (await w1view.balances()).native,
// 					w2after = (await w2.balances()).native;

// 				if (w1after === w1initial) {
// 					throw new Error('W1 still has initial balance');
// 				} else if (w2after === w2initial) {
// 					throw new Error('W2 still has initial balance');
// 				} else if (!onTxCalled) {
// 					throw new Error('onTx wasn\'t called');
// 				}

// 				console.log('W1', w1after);
// 				console.log('W2', w2after);
// 			}, 10000, 60);

// 			let after = (await w2.balances()).native;

// 			after.should.be.equal(w2initial + tx.operations[0].amount);

// 		} finally {
// 			await w1view.close();
// 			await w1sign.close();
// 			await w2.close();
// 		}
// 	}).timeout(5 * 60000);
// });

describe('stellar chain', () => {
	let D = {};

	describe('prepare', () => {
		it('should load config', async () => {
			CFG = await require('../core/config.js').load(__dirname + '/test-config-api.json');

			D.INITIAL_BALANCE = 100 * Math.pow(10, CFG.assetAccuracy);
			// D.bounce_cashin = 70 * Math.pow(10, CFG.assetAccuracy);
			D.AA_cashin = 80 * Math.pow(10, CFG.assetAccuracy);
			D.AB_cashin = 50 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_wrong = 1000 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_separate = 100 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WB_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WC_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);

			console.log(D);
		});
	});
		
	require('../core/tests-chain.js')(
		__dirname + '/test-config-api.json', 
		__dirname + '/api.js', 
		__dirname + '/test-config-sign.json', 
		__dirname + '/sign.js',
		D,
		{
			fill: async (API, SIGN) => {
				let res = await API.r.post('/api/testing/transfers').expect(200);
				console.log('WS', res.body);

				let WS = res.body,
					W1 = API.Wallet.createPaperWallet(),
					W2 = API.Wallet.createPaperWallet(),
					W3 = API.Wallet.createPaperWallet(),
					W4 = API.Wallet.createPaperWallet();

				res = await API.r.post('/api/testing/transfers').send({
					fromAddress: WS.address,
					fromPrivateKey: WS.seed,
					toAddress: [
						CFG.bounce ? W1.address + Wallet.SEPARATOR + CFG.bounce : W1.address, W2.address, W3.address, W4.address
					],
					amount: [
						D.INITIAL_BALANCE,
						D.INITIAL_BALANCE,
						D.INITIAL_BALANCE,
						D.INITIAL_BALANCE
					],
					assetId: CFG.assetId
				}).expect(200);

				console.log('WS => W1, W2, W3, W4', res.body);

				D.W = W1;
				D.WA = W2;
				D.WB = W3;
				D.WC = W4;
				D.AC = W4.address;

				console.log(D);
			},
			wait: utils.wait.bind(utils, 10000)
		});
});
