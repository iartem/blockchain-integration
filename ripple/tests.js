/* eslint-env mocha */

const Wallet = require('./wallet.js'),
	utils = require('../core/utils.js');

var CFG;

describe('ripple chain', () => {
	let D = {BOUNCE: true};

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
