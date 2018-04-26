/* eslint-env mocha */

/**
 * Standard blockchain test sequence:
 * prepare (done outside of this file since WS (seed wallet) logic is different in each chain):
 *    	1. Send (without API) 10 coins from WS to W, 10 coins from WS to WA & WB each for starting balance. Wait for confirmation.
 *    	thus, starting with 10 coins in each: W, WA, WB, WC
 * init :
 * 		1. Start API & SIGN servers for W.
 *   	2. Create wallets WA (alice), WB (bob), WC (carl).
 * setup:
 * 		1. Create addresses AA (alice in W), AB (bob in W). 
 *   	2. Start observing addresses & history. 
 * 	  	3. Check history: must be empty for AA & AB.
 * cash-in:
 * 		1. Cash-in alice for 8 coins. Wait for confirmation.
 * 		2. Check balance & history for WB: must have 1 cash-in.
 * 		3. Shutdown W.
 * 		4. Cash-in bob for 5 coins. Wait for confirmation.
 * 		5. Start W.
 * 		6. Check balance & history: must have 1 cash-in for each of AA & AB.
 * DW => HW:
 * 		1. Try 1 DW => HW transaction for both: WA & WB with WA amount greater than balance (9 coins). Check error.
 * 		2. Try 1 DW => HW transaction for both: WA & WB with WB amount less than minimum (0 coins). Check error.
 * 		3. Create 1 DW => HW transaction for both: WA & WB. 
 * 		4. Check balances, ensure nothing is returned (both are 0).
 * 		5. Check history, ensure 2 tx exist for each of AA & AB.
 * cash-out:
 * 		1. Try cashing out for 100 coins. Check error.
 * 		2. Cash-out to WA for 10 coins. Just send tx, don't wait for confirmation.
 * 		3. Shutdown W. Wait for confirmation.
 * 		4. Start W.
 * 		5. Check balance & history: must have no balances, but 1 cash-in for each of AA & AB & 1 cash-out for WA.
 * 		6. Cashout to WA, WB, WC for 3 coins each. Repeat until resolves (in Monero can take 10 blocks or so). Wait for confirmation.
 * 		7. Check balances & history: balances must not change, history must contain all transactions from above.
 */
module.exports = (apiConf, apiPath, signConf, signPath, D, BLOCKCHAIN) => {
	let API, SIGN, db, GUIDS = {
		dwhw: 'c701df3b-ef18-485e-9788-9e8e3eeccc92',
		cashoutWA: '5f657694-6759-473e-93f2-d3962e95aed1',
		cashoutWAWBWC: '59c94e58-2012-456e-813f-01dc3921afc0'
	};

	console.log(apiConf, apiPath, signConf, signPath, D);

	const supertest = require('supertest'),
		should = require('should');

	let tmp = require(apiConf);
	describe(tmp.chain + ': standard test sequence', () => {
		
		describe('init', () => {
			it('should clean db', async () => {
				let client;
				try {
					let cfg = require(apiConf), mongodb = require('mongodb');
					client = await mongodb.MongoClient.connect(cfg.store);
					db = client.db(cfg.store.split('/').pop());
					db.dropCollection('transactions').catch(() => {});
					db.dropCollection('accounts').catch(() => {});
				} catch (e) {
					console.log('exception while clearing db: %j / %j', e.message, e.stack);
				} finally {
					if (client) { try {client.close();} catch (ignored) {} }
				}
			}).timeout(5000);
			it('should start api', () => {
				process.env.SettingsUrl = apiConf;
				return require(apiPath).then(srv => {
					API = srv;
					API.r = supertest(API.server);
				});
			}).timeout(10000);
			it('should start sign', () => {
				process.env.SettingsUrl = signConf;
				return require(signPath).then(srv => {
					SIGN = srv;
					SIGN.r = supertest(SIGN.server);
				});
			}).timeout(10000);
			it('should fill initial balances', () => {
				return BLOCKCHAIN.fill(API, SIGN);
			}).timeout(60000 * 20);
			it('should initialize API', () => {
				return API.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view}).expect(200);
			}).timeout(10000);
			it('should initialize SIGN', () => {
				return SIGN.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view, WalletPrivateKey: D.W.seed}).expect(200);
			}).timeout(10000);
			it('W should be in ready state & have balance of 10/100 coins', () => {
				return API.utils.waitToResolve(async () => {
					// will return 400 if wallet is not ready yet
					await API.r.get('/api/balances?take=1').expect(200);

					console.log('currentBalance()', await API.wallet.currentBalance());

					if ((await API.wallet.currentBalance()) !== D.INITIAL_BALANCE) {
						throw new Error('Balance is not valid yet');
					}
				}, 6000, 10);
			}).timeout(60000 * 20);
		});

		describe('setup', () => {
			it('should create addresses AA & AB and start observing them', async () => {
				let res = await SIGN.r.post('/API/wallets').expect(200);
				should.exist(res.body.publicAddress);
				D.AA = res.body.publicAddress;

				res = await SIGN.r.post('/API/wallets').expect(200);
				should.exist(res.body.publicAddress);
				D.AB = res.body.publicAddress;

				D.AA.should.not.equal(D.AB);

				await API.r.post(`/api/balances/${D.AA}/observation`).expect(200);
				await API.r.post(`/api/balances/${D.AB}/observation`).expect(200);
				
				res = await API.r.get(`/api/transactions/history/from/${D.AA}?take=10`).expect(200);
				res.body.length.should.equal(0);
				
				res = await API.r.get(`/api/transactions/history/from/${D.AB}?take=10`).expect(200);
				res.body.length.should.equal(0);
				
				// await API.r.post(`/api/balances/${D.AB}/observation`).expect(200);
			});
		});

		if (D.BOUNCE) {
			describe('bounce', () => {
				it('should send payment from WC to W (to bounce)', async () => {
					let res = await API.r.post('/api/testing/transfers').send({
						fromAddress: D.WC.address,
						fromPrivateKey: D.WC.seed,
						toAddress: D.W.address,
						amount: D.bounce_cashin,
						assetId: API.CFG.assetId
					}).expect(200);

					console.log('WС => W to bounce', res.body);

					D.BOUNCED = res.body[0].hash;

				}).timeout(50000);

				it('should have tx to bounce in history', () => {
					return API.utils.waitToResolve(async () => {
						let res = await API.r.get(`/api/transactions/history/to/${D.W.address}?take=10&bounces=true`).expect(200),
							bounced = res.body.filter(tx => tx.bounced === false)[0];
						console.log(res.body);
						should.exist(bounced);
						bounced.fromAddress.should.equal(D.WC.address);
						bounced.toAddress.should.equal(D.W.address);
						bounced.amount.should.equal('' + D.bounce_cashin);
						bounced.operationId.should.equal('');
						bounced.bounced.should.equal(false);
						should.not.exist(bounced.bounce);
					}, 5000, 10);
				}).timeout(50000);
			});
		}

		describe('cash-in', () => {
			it('should cash-in alice (AA) for 8 coins', async () => {
				let res = await API.r.post('/api/testing/transfers').send({
					fromAddress: D.WA.address,
					fromPrivateKey: D.WA.seed,
					toAddress: D.AA,
					amount: D.AA_cashin,
					assetId: API.CFG.assetId
				}).expect(200);

				console.log('WA => AA 8', res.body);

				// let err = await retriableTx({}, API, SIGN, D.W.spend, 2);
			}).timeout(60000 * 20);

			it('should confirm 8-coin tx from alice', () => {
				return API.utils.waitToResolve(async () => {
					let res = await API.r.get('/api/balances?take=10').expect(200);
					console.log(res.body);
					let alice = res.body.items.filter(i => i.address === D.AA)[0];
					should.exist(alice);

					if (alice.balance === '0') {
						throw new Error('not confirmed yet');
					}

					if (alice.balance !== ('' + D.AA_cashin)) {
						throw new Error('invalid balance');
					}

					should.exist(alice.block);
					alice.assetId.should.equal(API.CFG.assetId);

				}, 6000, Math.ceil(2.5 * 10 * 2 * 60000 / 6000));
			}).timeout(Math.ceil(2.5 * 10 * 2 * 60000 + 10000));

			it('should shutdown W', async () => {
				try { await API.close(); } catch (ignored) {console.log(ignored);}
				try { await SIGN.close(); } catch (ignored) {console.log(ignored);}
				await API.utils.wait(1000);
			}).timeout(10000);

			it('should cash-in bob (AB) for 5 coins', async () => {
				let res = await API.r.post('/api/testing/transfers').send({
					fromAddress: D.WB.address,
					fromPrivateKey: D.WB.seed,
					toAddress: D.AB,
					amount: D.AB_cashin,
					assetId: API.CFG.assetId
				}).expect(200);

				console.log('WA => AB 5', res.body);
			}).timeout(60000 * 20);

			it('should start api', async () => {
				process.env.SettingsUrl = apiConf;
				await require(apiPath).reset().then(srv => {
					API = srv;
					API.r = supertest(API.server);
				});

				await API.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view}).expect(200);
			}).timeout(30000);

			it('should start sign', async () => {
				process.env.SettingsUrl = signConf;
				await require(signPath).reset().then(srv => {
					SIGN = srv;
					SIGN.r = supertest(SIGN.server);
				});
				await SIGN.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view, WalletPrivateKey: D.W.seed}).expect(200);
			}).timeout(30000);

			it('should have 1 cash-in for both: alice & bob', () => {
				return API.utils.waitToResolve(async () => {
					let res = await API.r.get('/api/balances?take=10').expect(200);
					console.log(res.body);

					let alice = res.body.items.filter(i => i.address === D.AA)[0],
						bob = res.body.items.filter(i => i.address === D.AB)[0];
					should.exist(alice);
					should.exist(bob);

					if (alice.balance === '0') {
						throw new Error('not confirmed yet');
					}

					if (alice.balance !== ('' + D.AA_cashin)) {
						throw new Error('invalid balance');
					}

					if (bob.balance === '0') {
						throw new Error('not confirmed yet');
					}

					if (bob.balance !== ('' + D.AB_cashin)) {
						throw new Error('invalid balance');
					}

					should.exist(alice.block);
					alice.assetId.should.equal(API.CFG.assetId);
					should.exist(bob.block);
					bob.assetId.should.equal(API.CFG.assetId);
				}, 6000, 2.5 * 10 * 2 * 60000 / 6000);
			}).timeout(2.5 * 10 * 2 * 60000 + 10000);

			it('should have history of cash-ins', async () => {
				let res = await API.r.get(`/api/transactions/history/to/${D.AA}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.WA.address);
				res.body[0].toAddress.should.equal(D.AA);
				res.body[0].amount.should.equal('' + D.AA_cashin);
				res.body[0].operationId.should.equal('');

				res = await API.r.get(`/api/transactions/history/from/${D.WA.address}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.WA.address);
				res.body[0].toAddress.should.equal(D.AA);
				res.body[0].amount.should.equal('' + D.AA_cashin);
				res.body[0].operationId.should.equal('');

				res = await API.r.get(`/api/transactions/history/to/${D.AB}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.WB.address);
				res.body[0].toAddress.should.equal(D.AB);
				res.body[0].amount.should.equal('' + D.AB_cashin);
				res.body[0].operationId.should.equal('');

				res = await API.r.get(`/api/transactions/history/from/${D.WB.address}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.WB.address);
				res.body[0].toAddress.should.equal(D.AB);
				res.body[0].amount.should.equal('' + D.AB_cashin);
				res.body[0].operationId.should.equal('');
			});
		});

		describe('DW => HW', () => {
			let tx;
			
			it('should return not enough funds for 9 coin attempt from AA', async () => {
				tx = {
					operationId: GUIDS.dwhw,
					inputs: [
						{fromAddress: D.AA, amount: '' + Math.ceil(D.AA_cashin * 11 / 10)},
						{fromAddress: D.AB, amount: '' + (D.AB_cashin)},
					],
					toAddress: D.W.address,
					assetId: API.CFG.assetId
				};
				let err = await retriableTx(tx, API, SIGN, D.W.seed, 1, true, false);
				should.exist(err);
				err.should.equal('notEnoughBalance');
			});
			it('should return not enough amount for 0 coin attempt from AB', async () => {
				tx = {
					operationId: GUIDS.dwhw,
					inputs: [
						{fromAddress: D.AA, amount: '' + D.AA_cashin},
						{fromAddress: D.AB, amount: '0'},
					],
					toAddress: D.W.address,
					assetId: API.CFG.assetId
				};
				await API.r.post('/api/transactions/many-inputs').send(tx).expect(400);
			});

			it('should pre-create (next test will retry it) dw => hw transaction for both: AA & AB', async () => {
				tx = {
					operationId: GUIDS.dwhw,
					inputs: [
						{fromAddress: D.AA, amount: '' + D.AA_cashin},
						{fromAddress: D.AB, amount: '' + D.AB_cashin},
					],
					toAddress: D.W.address,
					assetId: API.CFG.assetId
				};

				let res = await API.r.post('/api/transactions/many-inputs').send(tx);
				if (res.body.errorCode) {
					return res.body.errorCode;
				}
				should.exist(res.body.transactionContext);
			});

			it('should create dw => hw transaction for both: AA & AB', async () => {
				let err = await retriableTx(tx, API, SIGN, D.W.seed, 1, true, false);
				should.not.exist(err);

				let res = await API.r.get('/api/balances?take=10').expect(200);
				console.log(res.body);
				res.body.items.length.should.equal(0);

				res = await API.r.get(`/api/transactions/broadcast/many-inputs/${tx.operationId}`).expect(200);
				res.body.state.should.equal('completed');
			});

			it('should have history of DW => HW', async () => {
				let res = await API.r.get(`/api/transactions/history/from/${D.AA}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.AA);
				res.body[0].toAddress.should.equal(D.W.address);
				res.body[0].amount.should.equal('' + D.AA_cashin);
				res.body[0].operationId.should.equal(GUIDS.dwhw);

				res = await API.r.get(`/api/transactions/history/from/${D.AB}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.AB);
				res.body[0].toAddress.should.equal(D.W.address);
				res.body[0].amount.should.equal('' + D.AB_cashin);
				res.body[0].operationId.should.equal(GUIDS.dwhw);
			});
		});

		describe('cash-out', () => {
			let tx;

			it('should return error for 100 coin cashout attempt', async () => {
				tx = {
					operationId: GUIDS.cashoutWA,
					fromAddress: D.W.address,
					toAddress: D.WA.address,
					amount: '' + D.WA_cashout_wrong,
					assetId: API.CFG.assetId,
					includeFee: false
				};
				let err = await retriableTx(tx, API, SIGN, D.W.seed, 1);
				should.exist(err);
				err.should.equal('notEnoughBalance');
			}).timeout(5000);

			it('should cash-out 10 coins to WA', async () => {
				tx = {
					operationId: GUIDS.cashoutWA,
					fromAddress: D.W.address,
					toAddress: D.WA.address,
					amount: '' + D.WA_cashout_separate,
					assetId: API.CFG.assetId,
					includeFee: false
				};
				let err = await retriableTx(tx, API, SIGN, D.W.seed, 2);
				should.not.exist(err);

				let info = await API.store.tx({opid: tx.operationId});
				should.exist(info);

				tx.hash = info.hash;
			}).timeout(60000);

			it('should shutdown W', async () => {
				try { await API.close(); } catch (ignored) {console.log(ignored);}
				try { await SIGN.close(); } catch (ignored) {console.log(ignored);}
				await BLOCKCHAIN.wait(tx.hash);
			}).timeout(10 * 60000);

			it('should start api', async () => {
				process.env.SettingsUrl = apiConf;
				await require(apiPath).reset().then(srv => {
					API = srv;
					API.r = supertest(API.server);
				});

				await API.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view}).expect(200);
			}).timeout(30000);

			it('should start sign', async () => {
				process.env.SettingsUrl = signConf;
				await require(signPath).reset().then(srv => {
					SIGN = srv;
					SIGN.r = supertest(SIGN.server);
				});
				await SIGN.r.post('/api/initialize').send({WalletAddress: D.W.address, WalletViewKey: D.W.view, WalletPrivateKey: D.W.seed}).expect(200);
			}).timeout(30000);

			it('should have cashout to WA as completed', () => {
				return API.utils.waitToResolve(async () => {
					// will return 400 if wallet is not ready yet
					await API.r.get('/api/balances?take=1').expect(200);
					let res = await API.r.get(`/api/transactions/broadcast/single/${tx.operationId}`).expect(200);
					console.log(res.body);
					res.body.state.should.equal('completed');
				}, 6000, 36);
			}).timeout(60000);

			it('should have history of WA cash-out', async () => {
				let res = await API.r.get(`/api/transactions/history/to/${D.WA.address}?take=10`).expect(200);
				console.log(res.body);
				res.body.length.should.equal(1);
				res.body[0].fromAddress.should.equal(D.W.address);
				res.body[0].toAddress.should.equal(D.WA.address);
				res.body[0].amount.should.equal('' + D.WA_cashout_separate);
				res.body[0].operationId.should.equal(GUIDS.cashoutWA);
			});

			if (D.BOUNCE) {
				let bounceOpId, bounced;
				it('should have bounced=true in history', async () => {
					let res = await API.r.get(`/api/transactions/history/to/${D.W.address}?take=10&bounces=true`).expect(200),
						bounced = res.body.filter(tx => !!tx.bounced)[0];
					should.exist(bounced);
					bounceOpId = bounced.bounced;
					bounced.fromAddress.should.equal(D.WC.address);
					bounced.toAddress.should.equal(D.W.address);
					bounced.amount.should.equal('' + D.bounce_cashin);
					bounced.operationId.should.equal('');
					should.not.exist(bounced.bounce);
				}).timeout(5000);

				it('should have bounce tx in history', async () => {
					let res = await API.r.get(`/api/transactions/history/from/${D.W.address}?take=10&bounces=true`).expect(200),
						bounce = res.body.filter(tx => !!tx.bounce)[0];
					console.log(res.body);
					should.exist(bounce);
					bounce.fromAddress.should.equal(D.W.address);
					bounce.toAddress.should.equal(D.WC.address);
					// (parseInt(bounce.amount) + parseInt(bounce.fee)).should.equal('' + D.bounce_cashin);
					bounce.operationId.should.equal('');
					bounceOpId.should.equal(bounce.bounce);
					should.not.exist(bounce.bounced);
				}).timeout(5000);
			}

			if (D.MULTI_OUTS) {
				it('should cash-out .3 coins to WA, WB, WC', async () => {
					tx = {
						operationId: GUIDS.cashoutWAWBWC,
						fromAddress: D.W.address,
						outputs: [
							{toAddress: D.WA.address, amount: '' + D.WA_cashout},
							{toAddress: D.WB.address, amount: '' + D.WB_cashout},
							{toAddress: D.WC.address, amount: '' + D.WC_cashout},
						],
						assetId: API.CFG.assetId
					};

					let err = await retriableTx(tx, API, SIGN, D.W.seed, 100, false, true);
					should.not.exist(err);

					let info = await API.store.tx({opid: tx.operationId});
					should.exist(info);

					tx.hash = info.hash;
				}).timeout(30000 * 10);

				it('should have cash-out with status completed afrer a while', () => {
					return API.utils.waitToResolve(async () => {
						let res = await API.r.get(`/api/transactions/broadcast/single/${tx.operationId}`).expect(200);
						if (res.body.state !== 'completed'){
							throw new Error('not completed yet');
						}
					}, 6000, 30);
				}).timeout(6000 * 32);

				it('should have history of 3 cash-outs as well as dw=>hw', async () => {
					let res = await API.r.get(`/api/transactions/history/from/${D.W.address}?take=10`).expect(200);
					console.log(res.body);
					res.body.length.should.equal(6);
				});
			} else {
				it('should have history of 2 cash-outs and dw=>hw', async () => {
					let res = await API.r.get(`/api/transactions/history/from/${D.W.address}?take=10`).expect(200);
					console.log(res.body);
					res.body.length.should.equal(3);
				});
			}
		});

		after(async () => {
			try { API.close(); } catch (ignored) {}
			try { SIGN.close(); } catch (ignored) {}
		});
	});

	async function retriableTx(tx, api, sign, pk, attempts, multipleInputs, multipleOutputs) {
		let res;
		for (let i = 0; i < attempts; i++) {
			try {
				res = await api.r.post(multipleInputs ? '/api/transactions/many-inputs' : multipleOutputs ? '/api/transactions/many-outputs' : '/api/transactions/single').send(tx);
				if (res.body.errorCode) {
					return res.body.errorCode;
				}
				should.exist(res.body.transactionContext);

				res = await sign.r.post('/api/sign').send({privateKeys: [pk], transactionContext: res.body.transactionContext}).expect(200);
				should.exist(res.body.signedTransaction);

				res = await api.r.post('/api/transactions/broadcast').send({operationId: tx.operationId, signedTransaction: res.body.signedTransaction}).expect(200);
				return;
			} catch (ignored) {
				console.log('Ignoring %j / %j: %j', ignored.message, ignored.stack, res && res.body);
			}

			await api.utils.wait(30000);
		}
	}
};

