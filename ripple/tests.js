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
	let D = {BOUNCE: true};

	async function transfer (from, address, amount, wait) {
		let view, sign;
		try {
			view = createWallet();
			sign = createWallet();

			await view.initViewWallet(from.address);
			await sign.initSignWallet(from.address, from.seed);

			amount = Array.isArray(amount) ? amount : [amount];
			address = Array.isArray(address) ? address : [address];

			let fr = Wallet.addressDecode(from.address);

			let ids = [];
			for (var i = 0; i < amount.length; i++) {
				let tx = new Wallet.Tx('someid', 1, 0);
				
				let to = Wallet.addressDecode(address[i]);
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

			D.INITIAL_BALANCE = 100 * Math.pow(10, CFG.assetAccuracy);
			D.bounce_cashin = 70 * Math.pow(10, CFG.assetAccuracy);
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
