/* eslint-env mocha */

const Wallet = require('./wallet.js'),
	should = require('should'),
	fs = require('fs'),
	Log = require('../core/log.js'),
	utils = require('../core/utils.js');

var CFG, createWallet = () => new Wallet(CFG.testnet, CFG.node, Log('wallet'), () => console.log.bind(console, 'onTx'));

describe('monero chain', () => {
	let D = {MULTI_OUTS: true};

	async function transfer (from, address, amount, wait) {
		console.log(from, address, amount, wait);
		let wallet, waiter;

		try {
			wallet = new Wallet(CFG.testnet, CFG.node, Log('seedwallet'), console.log, 10000);
			await wallet.initSignWallet(from.address, from.seed);

			wallet.connect();
			wallet.refresh();

			let tx = new Wallet.Tx('someid', 1, 0);
			if (Array.isArray(amount)) {
				address.forEach((addr, i) => {
					let comps = wallet.addressDecode(addr);
					tx.addPayment(from.address, comps.address, CFG.assetOpKey, amount[i], undefined, comps.paymentId);
				});
			} else {
				let comps = wallet.addressDecode(address);
				tx.addPayment(from.address, comps.address, CFG.assetOpKey, amount, undefined, comps.paymentId);
			}

			let unsigned = await wallet.createUnsignedTransaction(tx);
			if (unsigned.error) {
				console.log('unsigned error', unsigned.error);
			} else {
				console.log('unsigned', Object.keys(unsigned));
			}
			should.exist(unsigned);
			should.exist(unsigned.unsigned);
			should.not.exist(unsigned.error);

			let signed = wallet.signTransaction(unsigned.unsigned);
			if (signed.error) {
				console.log('signed error', signed.error);
			} else {
				console.log('signed', Object.keys(signed));
			}
			console.log('signed', Object.keys(signed));
			should.exist(signed);
			should.exist(signed.signed);
			should.not.exist(signed.error);

			let sent = await wallet.submitSignedTransaction(signed.signed);
			console.log('sent', sent);

			wallet.close();
			wallet = null;

			if (wait) {
				waiter = new Wallet(CFG.testnet, CFG.node, Log('seedwallet-view'), console.log, 10000);
				await waiter.initViewWallet(wait.address, wait.view);

				while (true) {
					console.log('wallet balance', waiter.balance);
					if (waiter.balance.unlocked === waiter.balance.balance && waiter.balance.balance !== '0') {
						return;
					}
					await utils.wait(60000);
				}

			}

		} finally {
			try { if (wallet) { wallet.close(); } } catch (ignored) {console.log(ignored);}
			try { if (waiter) { waiter.close(); } } catch (ignored) {console.log(ignored);}
		}
	}

	describe('prepare', () => {
		before('should remove wallet files', () => {
			let names = fs.readdirSync(__dirname);
			names.filter(n => n.length > 50 || n === '.new').forEach(n => fs.unlinkSync(__dirname + '/' + n));
		});

		it('should load config', async () => {
			CFG = await require('../core/config.js').load(__dirname + '/test-config-api.json');
		});
		
		// it('should generate 4 new wallets & fill them with 10 coins', async () => {
		// 	D.W = { seed: '7fad0d3c80e62d1b4b5d68500d22d399906b4c1ce7e93c1e0bbee0b4df3fec06',
  //    view: '2a933079c27e53ff11a85806b32eb99a0df6efc91402ab02cbeda952b6e49204',
  //    address: '9vBrLpqsHPXjhceuRUPcfB7sWuW39RHL97HSCwu3nHDfhpqz9hBvFwRBd4x86H9XBxQpNvfyqU5vUZpv4muRaXbhEJ5ymXw',
  //    mnemonics: 'sack swagger apricot laptop voice anxiety rafts victim empty phase sighting hickory plywood eight gotten today runway tissue pact itinerary byline oars maul muffin byline' };
		// 	D.WA = { seed: '93f0f4b2011ba6375633f1350fbe7512a915bb28e0e5482225890538ce740d0f',
  //    view: 'aa79a3013f334d2168626b4dcf993cb87c0d1eedc8e07f4cf556225359cc610a',
  //    address: '9vifGBCFzL5CApi3ynAKPQKy7sx6zdBTL7BovrrGf5rGJ2iTmw8b7fYaokHtJVegEnUbikBu45bpyUgQczCHMTV8Mv4ZbN8',
  //    mnemonics: 'luggage biweekly stick unhappy agnostic elapse ionic ringing verification enforce huddle kiosk bawled napkin rhythm empty stellar vivid drowning remedy veered rigid egotistic fixate elapse' };
		// 	D.WB = { seed: '78abf444098fc4c21e36920535cb748310a1bd4d7802efdced24167f259c6a01',
  //    view: '25c09972179e898bdd1eff20f05092a6982e0c2e9fa1ed6fcc773dd782124500',
  //    address: '9z8bBVjiQ4TRZx1c1bn2Fm8HC1JGMTJj7Fr8UxYLHX3cfGs4CFKJJYnE3AtY4Y1WNh8ZPma7d7v2LLjm4YWBM3PxDdMDZE9',
  //    mnemonics: 'optical deity justice when unsafe pitched lurk tonic tycoon foes left zesty afoot girth pavements gadget films cobra axle misery alarms across zodiac abnormal cobra' };
		// 	D.WC = { seed: '0bb2fa40b1d637238ccd3e252395f7df3bf816979884d0cce48ba0649ffa0607',
  //    view: 'd593118c3f563d5acd3117e0abc51529daaec27d27486772bebe9de60a897502',
  //    address: 'A21S4sDkc5yatqQRcLHJdv6cYBaxpvBWaPTY2at5T4D3GeShhrAwvadG619VCYhjnTX11PtoYcNjvUVTYucRwjYAGDmcZnR',
  //    mnemonics: 'boil jury rekindle serving ember hockey pawnshop yeti byline boyfriend gossip dusted mixture foolish ungainly uneven noted hire veteran leech tsunami vary major motherly boyfriend' };
		// 	D.AC = D.WC.address;
		// 	D.INITIAL_BALANCE = 100 * 1e12;

		// 	console.log('DATA', D);
		// }).timeout(60000 * 2.5 * 15);	// 10 blocks to unlock + some time to sync view wallet

		it('should generate 4 new wallets & fill them with 10 coins', async () => {
			let wallet = createWallet();
			let W1 = wallet.createPaperWallet(),
				W2 = wallet.createPaperWallet(),
				W3 = wallet.createPaperWallet(),
				W4 = wallet.createPaperWallet();

			D.W = W1;
			D.WA = W2;
			D.WB = W3;
			D.WC = W4;
			D.AC = W4.address;

			D.INITIAL_BALANCE = 10 * Math.pow(10, CFG.assetAccuracy);
			D.AA_cashin = 8 * Math.pow(10, CFG.assetAccuracy);
			D.AB_cashin = 5 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_wrong = 100 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout_separate = 10 * Math.pow(10, CFG.assetAccuracy);
			D.WA_cashout = 2 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WB_cashout = 2 * Math.pow(10, CFG.assetAccuracy - 1);
			D.WC_cashout = 2 * Math.pow(10, CFG.assetAccuracy - 1);

			console.log('DATA', D);

			await transfer({address: CFG.seedAddress, view: CFG.seedView, seed: CFG.seedSeed}, [W1.address, W2.address, W3.address], [10e12, 10e12, 10e12], W3);
		}).timeout(60000 * 2.5 * 15);	// 10 blocks to unlock + some time to sync view wallet
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
