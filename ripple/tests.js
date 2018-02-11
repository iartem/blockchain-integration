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

var CFG, txes = {}, createWallet = () => new Wallet(CFG.testnet, CFG.node, Log('wallet'), (tx) => {
	txes[tx.hash] = tx;
	console.log('onTx', tx);
}, 10000);

describe('ripple chain', () => {
	let D = {};

	async function transfer (from, address, amount, wait) {
		let view, sign;
		try {
			view = createWallet();
			sign = createWallet();

			await view.initViewWallet(from.address);
			await sign.initSignWallet(from.address, from.seed);

			amount = Array.isArray(amount) ? amount : [amount];
			address = Array.isArray(address) ? address : [address];

			let fr = view.addressDecode(from.address);

			let ids = [];
			for (var i = 0; i < amount.length; i++) {
				let tx = new Wallet.Tx('someid', 1, 0);
				
				let to = view.addressDecode(address[i]);
				tx.addPayment(fr.address, to.address, CFG.assetOpKey, amount[i], fr.paymentId, to.paymentId);

				let unsigned = await view.createUnsignedTransaction(tx);
				console.log('unsigned', unsigned);
				should.exist(unsigned);
				should.exist(unsigned.unsigned);
				should.not.exist(unsigned.error);

				let signed = sign.signTransaction(unsigned.unsigned);
				console.log('signed', signed);
				ids.push(signed.signed.split('+')[0]);
				should.exist(signed);
				should.exist(signed.signed);
				should.not.exist(signed.error);

				let sent = await view.submitSignedTransaction(signed.signed);
				console.log('sent', sent);
			}

			for (let i = 0; i < 100; i++) {
				if (ids.filter(id => Object.keys(txes).indexOf(id) === -1).length !== 0) {
					await utils.wait(1000);
				}
			} 
		} finally {
			try { view.close(); } catch (ignored) {console.log(ignored);}
			try { sign.close(); } catch (ignored) {console.log(ignored);}
		}
	}

	describe('prepare', () => {
		it('should load config', async () => {
			CFG = await require('../core/config.js').load(__dirname + '/test-config-api.json');
		});
		
		it('should generate 4 new wallets & fill them with 100 coins', async () => {
			let wallet = createWallet();
			wallet.initViewWalletOffline();

			let transport = new Transport({url: 'https://faucet.altnet.rippletest.net/accounts', retryPolicy: (error, attempts) => {
				return error === 'timeout' || (error === null && attempts < 3);
			}, conf: {timeout: 15000, headers: {accept: 'application/json'}}});

			// {"account":{"address":"r3sg8QxXW33w9WcJYT146qsGYjBP7NSETA","secret":"snNGCLx7KUVQoy9HYCi6VjgkbybLi"},"balance":10000}
			let info = await transport.retriableRequest(null, 'POST');

			let WS = {address: info.account.address, seed: info.account.secret},
				W1 = wallet.createPaperWallet(),
				W2 = wallet.createPaperWallet(),
				W3 = wallet.createPaperWallet(),
				W4 = wallet.createPaperWallet();

			let hundred = 100 * Math.pow(10, CFG.assetAccuracy);

			await transfer(WS, [W1.address, W2.address, W3.address], [hundred, hundred, hundred]);

			D.W = W1;
			D.WA = W2;
			D.WB = W3;
			D.WC = W4;
			D.AC = W4.address;
			D.INITIAL_BALANCE = 100 * Math.pow(10, CFG.assetAccuracy);
			D.AA_cashin = 80 * Math.pow(10, CFG.assetAccuracy);
			D.AB_cashin = 50 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_wrong = 1000 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_separate = 100 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WB_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WC_cashout = 20 * Math.pow(10, CFG.assetAccuracy - 1);

			console.log(D);

		}).timeout(120000);
	});

	require('../core/tests-chain.js')(
		__dirname + '/test-config-api.json', 
		__dirname + '/api.js', 
		__dirname + '/test-config-sign.json', 
		__dirname + '/sign.js',
		D,
		{
			transfer: transfer,
			wait: utils.wait.bind(utils, 10000)
		});
});
