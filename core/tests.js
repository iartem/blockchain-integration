/* eslint-env mocha */

const should = require('should'),
	nock = require('nock'),
	Wallet = require('./wallet.js'),
	crypto = require('crypto'),
	supertest = require('supertest');

process.env.SettingsUrl = 'http://settings.com/settings.json';

const json = JSON.stringify({
	_id: '1',
	log: 'monitor',
	chain: 'monero',
	port: 3000
});

describe('config + transport', function() {

	it('should load config from HTTP successfully', async () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(200, json);

		const config = await require('./config.js').load();
		should.exist(config._id);
		should.exist(config.log);
		should.exist(config.chain);
		config._id.should.equal('1');
		config.log.should.equal('monitor');
		config.chain.should.equal('monero');
	}).timeout(5000);

	it('should load config from file successfully', async () => {
		const config = await require('./config.js').load(__dirname + '/test-config.json');
		should.not.exist(config._id);
		should.exist(config.log);
		should.exist(config.chain);
		should.exist(config.port);
		config.log.should.equal('test');
		config.chain.should.equal('testchain');
		config.port.should.equal(5000);
	});

	it('should return error when file doesn\'t exist', () => {
		return require('./config.js').load(__dirname + '/no-such-file.json').should.be.rejectedWith(`Cannot find module '${__dirname + '/no-such-file.json'}'`);
	});

	it('should return error when 404', () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(404);

		return require('./config.js').load().should.be.rejectedWith('Unretriable error for http://settings.com/settings.json: 404');
	});

	it('should return error when 500', () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(500);

		return require('./config.js').load().should.be.rejectedWith('Unretriable error for http://settings.com/settings.json: 500');
	});

	it('should return error when json is invalid', () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(200, json + '}');

		return require('./config.js').load().should.be.rejectedWith('Unretriable error for http://settings.com/settings.json: not a json response');
	});

	it('handles wrong content-type well', async () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(200, json, {'content-type': 'some/bad'});

		const config = await require('./config.js').load();
		should.exist(config._id);
		should.exist(config.log);
		should.exist(config.chain);
		config._id.should.equal('1');
		config.log.should.equal('monitor');
		config.chain.should.equal('monero');
	});

	it('handles text/plain well', async () => {
		nock('http://settings.com')
			.get('/settings.json')
			.reply(200, json, {'content-type': 'text/plain'});

		const config = await require('./config.js').load();
		should.exist(config._id);
		should.exist(config.log);
		should.exist(config.chain);
		config._id.should.equal('1');
		config.log.should.equal('monitor');
		config.chain.should.equal('monero');
	});

	it('should return error after 3 timeouts', () => {
		nock('http://settings.com')
			.persist()
			.get('/settings.json')
			.socketDelay(3100)
			.reply((uri, requestBody, cb) => {
				setTimeout(cb, 3100);
			});

		return (async () => {
			try {
				let result = await require('./config.js').load();
				should.fail(`Should throw 'timeout', but returned ${JSON.stringify(result)} instead`);
			} catch (e) {
				e.message.should.be.equal('All retries were spent, won\'t retry again: "timeout"');
			} finally {
				nock.cleanAll();
			}
		})();
	}).timeout(3200 * 4);

	it('should return config after 2 timeouts and 3-rd response', () => {
		nock('http://settings.com')
			.get('/settings.json')
			.socketDelay(3100)
			.reply(200)
			.get('/settings.json')
			.socketDelay(3100)
			.reply(200)
			.get('/settings.json')
			.reply(200, json);

		return (async () => {
			try {
				let config = await require('./config.js').load();
				should.exist(config._id);
				should.exist(config.log);
				should.exist(config.chain);
				config._id.should.equal('1');
				config.log.should.equal('monitor');
				config.chain.should.equal('monero');
			} catch (e) {
				should.fail(`Should succeed after 2 attempts but returned ${JSON.stringify(e)} instead`);
			} finally {
				nock.cleanAll();
			}
		})();
	}).timeout(3200 * 4);
});

describe('core server', () => {
	var SRV;
	it ('should return correct response on basic GET / POST / DELETE', () => {
		return require('./index.js')(__dirname + '/test-config.json', {
			GET: {
				'/get': ctx => {
					ctx.status = 200;
					ctx.body = {ok: true};
				},
				'/test-store': async ctx => {
					let key = 'test' + Date.now(),
						value = Date.now() + 'some test string';
					
					let ok = await ctx.store.tx(key, {a: value}, true);
					if (!ok) {
						throw new Error('tx not stored');
					}

					ok = await ctx.store.tx(key);
					if (!ok) {
						throw new Error('tx not found');
					}

					ctx.status = ok.a === value ? 200 : 400;
					ctx.body = {ok: ctx.status === 200};

					ok = await ctx.store.txDelete(key);
					if (!ok) {
						throw new Error('tx not deleted');
					}
				}
			},
			DELETE: {
				'/delete': ctx => {
					ctx.status = 204;
				}
			},
			POST: {
				'/post/:id/observe': ctx => {
					ctx.validateParam('id').required('id url parameter is required').isNumeric('id url parameter must be a number');
					ctx.validateBody('name').required('name body parameter is required').isString('name body parameter must be string');

					ctx.body = {
						id: parseInt(ctx.params.id),
						name: ctx.request.body.name
					};
				},
				'/post/:operationId/check': ctx => {
					ctx.validateParam('operationId').required('is required').isGUID('must be a GUID');

					ctx.body = {};
				}
			}
		}).then(async srv => {
			SRV = srv;
			SRV.wallet = {status: Wallet.Status.Ready};
			const request = supertest(srv.server);

			await request.get('/')
				.expect('Content-Type', 'text/plain; charset=utf-8')
				.expect(200, `Lykke ${srv.CFG.chain} server`);

			await request.get('/get')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.ok);
					res.ok.should.equal(true);
				});

			await request.get('/test-store')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.ok);
					res.ok.should.equal(true);
				});

			await request.delete('/delete')
				.expect(204);

			await request.post('/post/1/observe')
				.send({name: 'test'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {id: 1, name: 'test'});

			await request.post('/post/1/observe')
				.send({notAName: 1})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorCode: 'unknown', errorMessage: 'Validation Error', modelErrors: {name: ['name body parameter is required']}});

			await request.post('/post/not-a-number/observe')
				.send({name: 'test'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorCode: 'unknown', errorMessage: 'Validation Error', modelErrors: {id: ['id url parameter must be a number']}});

			await request.post('/post/not-op-id/check')
				.send({name: 'test'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorCode: 'unknown', errorMessage: 'Validation Error', modelErrors: {operationId: ['must be a GUID']}});

			await request.post('/post/123/check')
				.send({name: 'test'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorCode: 'unknown', errorMessage: 'Validation Error', modelErrors: {operationId: ['must be a GUID']}});

			await request.post('/post/b7550f98-92ac-4cf3-8423-abba46b3165a/check')
				.send({name: 'test'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {});

			await request.delete('/no-such-endpoint')
				.expect(404);

		}, (err) => {
			should.fail(err);
		});
	}).timeout(5000);

	after(async () => {
		if (SRV) { await SRV.close(); }
	});
});

describe('core api server', () => {
	var API, Wallet = require('./wallet.js'), request;

	var DATA = {
		A0: 'AAAAAAAAAA',
		A1: 'ABBpFJS8MQ',
		A2: 'QUa1nBfhE9',
		A3: 'aAibzjqPdv',
		A4: 'nKiLkwWZmh',
		A5: 'jqPdvmP7RF',
		A6: 'ksadYWlaH2',
		
		AX: '12adlsd2Sn',

		T1: 't1',
		T2: 't2',
		TX: 'tx'
	};

	describe('init', () => {
		it ('should start core api server', () => {
			
			class TestWallet extends Wallet {
				async initViewWallet () { 
					this.status = Wallet.Status.Loading;
					await require('./utils.js').wait(2000);
					this.status = Wallet.Status.Ready;
				}
				address() { return DATA.A0; }
				static addressDecode(str) { 
					if (str.length !== 10) {
						return;
					} 
					if (str === DATA.AX) {
						return {address: DATA.A0, paymentId: 'pid'};
					}
					if (str === DATA.A0) {
						return {address: DATA.A0};
					}
					return {address: str};
				}
				block () { return Date.now(); }
				async createUnsignedTransaction (tx) {
					if (tx.amount === 1000) {
						return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_FUNDS), fees: '1'};
					} else if (tx.amount === 1) {
						return {error: new Wallet.Error(Wallet.Errors.NOT_ENOUGH_AMOUNT)};
					} else if (tx.operations[0].from === DATA.A0 && tx.operations[0].sourcePaymentId === 'pid' && tx.operations[0].to === DATA.A0) {
						return {unsigned: 'nope-nope', fees: '1'};
					} else {
						return {unsigned: 'unsigneddata', fees: '1'}; 
					}
				}
				constructFullSyncData () { return {syncdata: 'syncdata'}; }
				signTransaction (unsigned) { return {signed: unsigned + 'signed'}; }
				async submitSignedTransaction (signed) { return {hash: signed + 'sent', timestamp: Date.now()}; }
				async close() {
					await API.utils.wait(500);
				}
			}

			return require('./index-api.js')(__dirname + '/test-config.json', {}, TestWallet).then(srv => {
				API = srv;
				request = supertest(API.server);

				API.store.db.dropCollection('transactions').catch(() => {});
				API.store.db.dropCollection('accounts').catch(() => {});
				API.store.db.dropCollection('history').catch(() => {});
			});
		}).timeout(10000);

		it('should return not ready until refresh is done', async () => {
			await request.post('/api/transactions/single')
				.send({operationId: '123'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Wallet is not ready yet, please try again later'});

			await API.utils.wait(2000);

			await request.post('/api/transactions/single')
				.send({operationId: '123'})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {assetId: ['is required']}});
		}).timeout(5000);
	});

	describe('basics', () => {
		it('should return welcome message on /', async () => {
			await request.get('/')
				.expect('Content-Type', 'text/plain; charset=utf-8')
				.expect(200, `Lykke ${API.CFG.chain} server`);
		});

		it('should return 501 on PUT /api/transactions', async () => {
			await request.put('/api/transactions')
				.expect(501);
		});

		it('should return correct alive message on /api/isalive', async () => {
			let defaults = require('./test-config.json');

			await request.get('/api/isalive')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {name: defaults.serviceName, version: defaults.version, env: null, isDebug: defaults.testnet, contractVersion: '1.1.0'});
		});

		it('should return correct response on /api/capabilities', async () => {
			await request.get('/api/capabilities')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isTransactionsRebuildingSupported: false, areManyInputsSupported: true, 
					areManyOutputsSupported: true, isTestingTransfersSupported: true, isPublicAddressExtensionRequired: true});
		});
	});

	describe('assets', () => {
		it('should return array of assets', () => {
			return request.get('/api/assets?take=10')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {continuation: null, items: [{assetId: API.CFG.assetId, address: '', name: API.CFG.assetName, accuracy: API.CFG.assetAccuracy}]});
		});
		it('should return asset by id', () => {
			return request.get(`/api/assets/${API.CFG.assetId}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {assetId: API.CFG.assetId, address: '', name: API.CFG.assetName, accuracy: API.CFG.assetAccuracy});
		});
		it('should return error if wrong assed id supplied', () => {
			return request.get('/api/assets/wrongid')
				.expect(204);
		});
	});

	describe('address validation', () => {
		it('should return success if valid standard address is provided', () => {
			return request.get(`/api/addresses/${DATA.A0}/validity`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isValid: true});
		});
		it('should return success if valid integrated address is provided', () => {
			return request.get(`/api/addresses/${DATA.A1}/validity`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isValid: true});
		});
		it('should return failure if valid standard address is provided', () => {
			return request.get(`/api/addresses/${DATA.A0 + '123'}/validity`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isValid: false});
		});
	});

	describe('address monitoring', () => {
		describe('empty balances', () => {
			
			it('should return error with no params', () => {
				return request.get('/api/balances')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: ['is required']}});
			});
			
			it('should return error with take=0', () => {
				return request.get('/api/balances?take=0')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: ['must be greater than 0']}});
			});
			
			it('should return error with take=100000', () => {
				return request.get('/api/balances?take=100000')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: ['must be less than 1000']}});
			});
			
			it('should return error with invalid continuation', () => {
				return request.get('/api/balances?take=100&continuation=asfd')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {continuation: ['must be an int-in-string']}});
			});
			
			it('should return empty list with take=100', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});
			
		});

		describe('address observation', () => {
			it('should return error if address with invalid length provided', () => {
				return request.post('/api/balances/555aaa/observation')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {address: [`must be valid ${API.CFG.chain} address`]}});
			});
			it('should successfully obvserve A1-A6', () => {
				return Promise.all([
					request.post(`/api/balances/${DATA.A1}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A2}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A3}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A4}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A5}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A6}/observation`).expect(200),
					request.post(`/api/balances/${DATA.AX}/observation`).expect(200)
				]);
			});

			it('should still return [] on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});

			it('should manual write balances to mongo for A2-A5', async () => {
				let set = await API.store.account(DATA.A2, {balance: 10});
				set.should.equal(1);

				set = await API.store.account(DATA.A3, {balance: 5});
				set.should.equal(1);

				set = await API.store.account(DATA.A4, {balance: 12});
				set.should.equal(1);

				set = await API.store.account(DATA.A5, {balance: 11});
				set.should.equal(1);

				set = await API.store.account(DATA.AX, {balance: 100, paymentId: 'pid'});
				set.should.equal(1);
			});

			it('should now return 4 items on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.AX, assetId: API.CFG.assetId, balance: 100},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: 10},
						{address: DATA.A3, assetId: API.CFG.assetId, balance: 5},
						{address: DATA.A5, assetId: API.CFG.assetId, balance: 11},
						{address: DATA.A4, assetId: API.CFG.assetId, balance: 12},
					]});
			});

			it('should return 3 items & continuation on /api/balances with take=3', () => {
				return request.get('/api/balances?take=3')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: '3', items: [
						{address: DATA.AX, assetId: API.CFG.assetId, balance: 100},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: 10},
						{address: DATA.A3, assetId: API.CFG.assetId, balance: 5},
					]});
			});

			it('should return 3 items & continuation on /api/balances with take=3 & empty continuation', () => {
				return request.get('/api/balances?take=3&continuation=')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: '3', items: [
						{address: DATA.AX, assetId: API.CFG.assetId, balance: 100},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: 10},
						{address: DATA.A3, assetId: API.CFG.assetId, balance: 5},
					]});
			});

			it('should return 1 item & no continuation on /api/balances with take=3&continuation=3', () => {
				return request.get('/api/balances?take=3&continuation=3')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.A5, assetId: API.CFG.assetId, balance: 11},
						{address: DATA.A4, assetId: API.CFG.assetId, balance: 12},
					]});
			});

			it('should return 0 items & no continuation on /api/balances with take=3&continuation=4', () => {
				return request.get('/api/balances?take=3&continuation=5')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});

			it('should return error items on /api/balances with take=3&continuation=0', () => {
				return request.get('/api/balances?take=3&continuation=0')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {continuation: ['must be greater than 0']}});
			});

			it('should successfully delete A5 from observation list', () => {
				return request.delete(`/api/balances/${DATA.A5}/observation`)
					.expect(200);
			});

			it('should return error on deletion of non-existent A0', () => {
				return request.delete(`/api/balances/${DATA.A0}/observation`)
					.expect(204);
			});

			it('should now return only 4 items on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.AX, assetId: API.CFG.assetId, balance: 100},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: 10},
						{address: DATA.A3, assetId: API.CFG.assetId, balance: 5},
						{address: DATA.A4, assetId: API.CFG.assetId, balance: 12},
					]});
			});
		});
	});

	describe('create transaction validation', () => {
		it('/api/transactions/single DW => HW insufficient balance', () => {
			return request.post('/api/transactions/single')
				.send({operationId: 'xxx', fromAddress: DATA.AX, toAddress: DATA.A0, assetId: API.CFG.assetId, amount: '101', includeFee: true})
				.expect(200)
				.expect(res => {
					should.exist(res.body.errorCode);
					res.body.errorCode.should.equal('notEnoughBalance');
				});
		});

		it('/api/transactions/many-inputs DW => HW insufficient balance', () => {
			return request.post('/api/transactions/many-inputs')
				.send({operationId: 'xxx', inputs: [{fromAddress: DATA.AX, amount: '101'}], toAddress: DATA.A0, assetId: API.CFG.assetId, includeFee: true})
				.expect(200)
				.expect(res => {
					should.exist(res.body.errorCode);
					res.body.errorCode.should.equal('notEnoughBalance');
				});
		});

		it('/api/transactions/many-outputs insufficient balance', () => {
			return request.post('/api/transactions/many-outputs')
				.send({operationId: 'xxx', fromAddress: DATA.A0, outputs: [{toAddress: DATA.A3, amount: '1000'}], assetId: API.CFG.assetId, includeFee: false})
				.expect(200)
				.expect(res => {
					should.exist(res.body.errorCode);
					res.body.errorCode.should.equal('notEnoughBalance');
				});
		});
		it('/api/transactions/many-outputs low amount', () => {
			return request.post('/api/transactions/many-outputs')
				.send({operationId: 'xxx', fromAddress: DATA.A0, outputs: [{toAddress: DATA.A3, amount: '1'}], assetId: API.CFG.assetId, includeFee: false})
				.expect(200)
				.expect(res => {
					should.exist(res.body.errorCode);
					res.body.errorCode.should.equal('amountIsTooSmall');
				});
		});
		it('/api/transactions/single DW => HW wrong source', () => {
			return request.post('/api/transactions/single')
				.send({operationId: 'xxx', fromAddress: DATA.A2, toAddress: DATA.A3, assetId: API.CFG.assetId, amount: '101', includeFee: true})
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {fromAddress: ['Only wallet-originated transactions supported']}});
		});

		it('/api/transactions/many-inputs DW => HW wrong destination', () => {
			return request.post('/api/transactions/many-inputs')
				.send({operationId: 'xxx', inputs: [{fromAddress: DATA.AX, amount: '101'}], toAddress: DATA.A2, assetId: API.CFG.assetId, includeFee: true})
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {toAddress: ['Only wallet-targeted transactions with multiple inputs supported']}});
		});

		it('/api/transactions/many-outputs DW => HW wrong source', () => {
			return request.post('/api/transactions/many-outputs')
				.send({operationId: 'xxx', fromAddress: DATA.A2, outputs: [{toAddress: DATA.A1, amount: '1000'}], assetId: API.CFG.assetId, includeFee: true})
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {fromAddress: ['Only wallet-originated transactions with multiple outputs supported']}});
		});
	});

	describe('1-to-1 transaction handling', () => {
		var T1, T2, TX;

		it('should successfully obvserve T1-T2', () => {
			T1 = {operationId: DATA.T1, fromAddress: DATA.A0, toAddress: DATA.A1, assetId: API.CFG.assetId, amount: 11, includeFee: true};
			T2 = {operationId: DATA.T2, fromAddress: DATA.A0, toAddress: DATA.A2, assetId: API.CFG.assetId, amount: 12, includeFee: true};
			TX = {operationId: DATA.TX, fromAddress: DATA.AX, toAddress: DATA.A0, assetId: API.CFG.assetId, amount: 13, includeFee: true};
			return Promise.all([
				request.post('/api/transactions/single').send(T1).expect(200).expect(res => {
					should.exist(res.body.transactionContext);
					res.body.transactionContext.should.equal('unsigneddata');
					T1.unsigned = res.body.transactionContext;
				}),
				request.post('/api/transactions/single').send(T2).expect(200).expect(res => {
					should.exist(res.body.transactionContext);
					res.body.transactionContext.should.equal('unsigneddata');
					T2.unsigned = res.body.transactionContext;
				}),
				request.post('/api/transactions/single').send(TX).expect(200).expect(res => {
					should.exist(res.body.transactionContext);
					res.body.transactionContext.should.equal('nope');
					TX.unsigned = res.body.transactionContext;
				}),
			]);
		});

		it('should not return T1 - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T1}`)
				.expect(204);
		});
		it('should not return T2 - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T2}`)
				.expect(204);
		});
		it('should not return TX (self to self) - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.TX}`)
				.expect(204);
		});

		it('should broadcast T1', () => {
			return request.post('/api/transactions/broadcast')
				.send({operationId: DATA.T1, signedTransaction: 'blob1'})
				.expect(200);
		});

		it('should not broadcast T1 again', () => {
			return request.post('/api/transactions/broadcast')
				.send({operationId: DATA.T1, signedTransaction: 'blob1'})
				.expect(409);
		});

		it('still should not return T2 - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T2}`)
				.expect(204);
		});

		it('should broadcast T2', () => {
			return request.post('/api/transactions/broadcast')
				.send({operationId: DATA.T2, signedTransaction: 'blob2'})
				.expect(200);
		});

		it('should broadcast TX (self to self)', () => {
			return request.post('/api/transactions/broadcast')
				.send({operationId: DATA.TX, signedTransaction: 'blob3'})
				.expect(200);
		});

		it('should return T1', () => {
			T1.state = 'inProgress';
			return request.get(`/api/transactions/broadcast/single/${DATA.T1}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.operationId);
					should.exist(res.body.state);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.block);
					should.not.exist(res.body.error);
					should.not.exist(res.body.errorCode);
					res.body.state.should.equal(T1.state);
					res.body.operationId.should.equal(T1.operationId);
					res.body.amount.should.equal(T1.amount + '');
					T1 = res.body;
				});
		});
		it('should return T2', () => {
			T2.state = 'inProgress';
			return request.get(`/api/transactions/broadcast/single/${DATA.T2}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.operationId);
					should.exist(res.body.state);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.error);
					res.body.state.should.equal(T2.state);
					res.body.operationId.should.equal(T2.operationId);
					res.body.amount.should.equal(T2.amount + '');
					res.body.fee.should.equal('0');
					T2 = res.body;
				});
		});

		it('should return TX (self to self) with state completed', () => {
			TX.state = 'completed';
			return request.get(`/api/transactions/broadcast/single/${DATA.TX}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.operationId);
					should.exist(res.body.state);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.error);
					res.body.state.should.equal(TX.state);
					res.body.operationId.should.equal(TX.operationId);
					res.body.amount.should.equal(TX.amount + '');
					res.body.fee.should.equal('0');
					TX = res.body;
				});
		});

		it('should successfully delete T1 from observation list', () => {
			return request.delete(`/api/transactions/broadcast/${DATA.T1}`)
				.expect(200);
		});
		it('should not return T1 - deleted', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T1}`)
				.expect(204);
		});
		it('should still return T2', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T2}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200);
		});

		it('should successfully delete T2 from observation list', () => {
			return request.delete(`/api/transactions/broadcast/${DATA.T2}`)
				.expect(200);
		});
		it('should not return T2 - deleted', () => {
			return request.get(`/api/transactions/broadcast/single/${DATA.T2}`)
				.expect(204);
		});
	});

	describe('error handling in transaction processing', () => {
		it('should drop collections', () => {
			return Promise.all([
				API.store.db.dropCollection('transactions').catch(() => {}),
				API.store.db.dropCollection('accounts').catch(() => {}),
				API.store.db.dropCollection('history').catch(() => {})
			]);
		});

		it('should handle resync on tx create & tx submit correctly', async () => {
			await request.post(`/api/balances/${DATA.A1}/observation`).expect(200);
			await request.post(`/api/balances/${DATA.AX}/observation`).expect(200);

			let create = API.wallet.createUnsignedTransaction, resync = API.wallet.constructFullSyncData, submit = API.wallet.submitSignedTransaction;
			try {
				// override wallet to return sync required & retry required errors
				let resyncCalled = false;
				API.wallet.createUnsignedTransaction = async () => {
					return {error: new Wallet.Error(Wallet.Errors.SYNC_REQUIRED)};
				};
				API.wallet.constructFullSyncData = () => { 
					resyncCalled = true;
					return {outputs: 'outputsdata'}; 
				};
				API.wallet.submitSignedTransaction = async () => { 
					return {
						error: new Wallet.Error(Wallet.Errors.RETRY_REQUIRED)
					};
				};

				let T1 = {operationId: DATA.T1, fromAddress: DATA.A0, toAddress: DATA.A1, assetId: API.CFG.assetId, amount: 11, includeFee: true};
				let resp = await request.post('/api/transactions/single').send(T1).expect(200);

				// here it should have outputsc
				should.exist(resp.body.transactionContext);
				resp.body.transactionContext.should.equal('outputsdata');
				resyncCalled.should.equal(true);

				resp = API.wallet.signTransaction(resp.body.transactionContext);
				should.exist(resp.signed);
				
				// broadcast should return retry required, thus failing tx
				await request.post('/api/transactions/broadcast').send({operationId: DATA.T1, signedTransaction: resp.signed}).expect(400);
				resp = await request.get(`/api/transactions/broadcast/single/${DATA.T1}`).expect(200);
				resp.body.state.should.equal('failed');

				await request.delete(`/api/transactions/broadcast/${DATA.T1}`).expect(200);

				// now assuming resync is done, return correct tx
				resyncCalled = false;
				API.wallet.createUnsignedTransaction = async () => {
					return {unsigned: 'unsigneddata'};
				};
				API.wallet.submitSignedTransaction = async () => { 
					return {
						hash: 'unsigneddatasignedsent'
					};
				};

				resp = await request.post('/api/transactions/single').send(T1).expect(200);

				// unsigned data returned
				should.exist(resp.body.transactionContext);
				resp.body.transactionContext.should.equal('unsigneddata');
				resyncCalled.should.equal(false);

				resp = API.wallet.signTransaction(resp.body.transactionContext);
				should.exist(resp.signed);
				
				// tx is broadcasted well
				await request.post('/api/transactions/broadcast').send({operationId: DATA.T1, signedTransaction: resp.signed}).expect(200);
				// and exists in get call
				resp = await request.get(`/api/transactions/broadcast/single/${DATA.T1}`).expect(200);
				// with inProgress status
				resp.body.state.should.equal('inProgress');

			} finally {
				API.wallet.createUnsignedTransaction = create;
				API.wallet.constructFullSyncData = resync;
				API.wallet.submitSignedTransaction = submit;
			}
		});
	});


	after(() => {
		if (API) {
			return Promise.all([
				API.store.db.dropCollection('transactions').catch(() => {}),
				API.store.db.dropCollection('accounts').catch(() => {}),
				API.store.db.dropCollection('history').catch(() => {})
				// Promise.resolve()
			]).then(async () => {
				await API.close();
			});
		}
	});
});

describe('core sign service', () => {
	var SIG, request;
	it ('should start core server', () => {
		class TestWallet extends Wallet {
			async initViewWallet () { 
				this.status = Wallet.Status.Loading;
				await SIG.utils.wait(2000);
				this.status = Wallet.Status.Ready;
			}
			initViewWalletOffline () { 
				this.status = Wallet.Status.Ready;
			}
			async initSignWallet () { 
				this.status = Wallet.Status.Loading;
				await SIG.utils.wait(500);
				this.status = Wallet.Status.Ready;
			}
			addressCreate(pid) { 
				return pid || crypto.randomBytes(10).toString('hex');
			}
			signTransaction (tx) {
				if (tx === 'ok') {
					return {signed: tx + 'signed'};
				}
				if (tx === 'raise-wallet') {
					throw new Wallet.Error(Wallet.Errors.EXCEPTION, 'demo error');
				}
				if (tx === 'raise-comnmon') {
					throw new Error('demo error');
				}
				return {error: new Wallet.Error(Wallet.Errors.EXCEPTION, 'demo error')};
			}
			async close() {
				await SIG.utils.wait(500);
			}
		}

		return require('./index-sign.js')(__dirname + '/test-config.json', {}, TestWallet).then(srv => {
			SIG = srv;
			request = supertest(SIG.server);
			return SIG;
		});
	}).timeout(10000);

	it ('should return welcome message on /', async () => {
		await request.get('/')
			.expect('Content-Type', 'text/plain; charset=utf-8')
			.expect(200, `Lykke ${SIG.CFG.chain} server`);
	});

	it ('should return correct alive message on /api/isalive', async () => {
		let defaults = require('./test-config.json');

		await request.get('/api/isalive')
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200, {name: defaults.serviceName, version: defaults.version, env: null, isDebug: defaults.testnet});
	});

	it ('should return new wallet on /api/wallets', async () => {
		await request.post('/api/wallets')
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200)
			.then(res => {
				should.exist(res.body.publicAddress);
				should.exist(res.body.privateKey);
				res.body.publicAddress.should.not.be.empty();
				res.body.privateKey.should.not.be.empty();
			}, err => should.fail(err));
	});

	it ('should return specific address on /api/wallets if payment id is specified', async () => {
		let pid = '45d916d3fff755f2';
		await request.post('/api/wallets')
			.send({paymentId: pid})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200)
			.then(res => {
				should.exist(res.body.publicAddress);
				res.body.publicAddress.should.equal(pid);
			}, err => should.fail(err));
	});

	it ('should return error if paymentId is not a string on /api/wallets', async () => {
		await request.post('/api/wallets')
			.send({paymentId: 1})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.paymentId);
				res.body.modelErrors.paymentId[0].should.equal('must be a string');
			}, err => should.fail(err));
	});

	it ('should return error if no privateKeys specied /api/sign', async () => {
		await request.post('/api/sign')
			.send({transactionContext: 'ok'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.privateKeys);
				res.body.modelErrors.privateKeys[0].should.equal('is required');
			}, err => should.fail(err));
	});

	it ('should return error if privateKeys is not an array on /api/sign', async () => {
		await request.post('/api/sign')
			.send({privateKeys: 'str', transactionContext: 'ok'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.privateKeys);
				res.body.modelErrors.privateKeys[0].should.equal('must be an array');
			}, err => should.fail(err));
	});

	it ('should return error if privateKeys is not an array of length 1 on /api/sign', async () => {
		await request.post('/api/sign')
			.send({privateKeys: ['str1', 'str2'], transactionContext: 'ok'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.privateKeys);
				res.body.modelErrors.privateKeys[0].should.equal('must have 1 private key');
			}, err => should.fail(err));
	});

	it ('should return error if no transactionContext is specified on /api/sign', async () => {
		await request.post('/api/sign')
			.send({privateKeys: ['k1']})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.transactionContext);
				res.body.modelErrors.transactionContext[0].should.equal('is required');
			}, err => should.fail(err));
	});

	it ('should succeed on valid /api/sign', () => {
		return request.post('/api/sign')
			.send({privateKeys: ['k1'], transactionContext: 'ok'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200, {signedTransaction: 'oksigned'});
	});
	it ('should return error if transactionContext is wrong on /api/sign', () => {
		return request.post('/api/sign')
			.send({privateKeys: ['k1'], transactionContext: 'bad'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.expect(res => {
				should.exist(res.body.errorMessage);
				should.not.exist(res.body.modelErrors);
				res.body.errorMessage.should.equal('Wallet error: Exception: demo error');
			});
	});
	it ('should return error if wallet throws wallet error on /api/sign', () => {
		return request.post('/api/sign')
			.send({privateKeys: ['k1'], transactionContext: 'raise-wallet'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.expect(res => {
				should.exist(res.body.errorMessage);
				should.not.exist(res.body.modelErrors);
				res.body.errorMessage.should.equal('Wallet error: Exception: demo error');
			});
	});
	it ('should return error if wallet throws standard error on /api/sign', () => {
		return request.post('/api/sign')
			.send({privateKeys: ['k1'], transactionContext: 'raise-comnmon'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.expect(res => {
				should.exist(res.body.errorMessage);
				should.not.exist(res.body.modelErrors);
				res.body.errorMessage.should.equal('Wallet error: Exception: demo error');
			});
	});

	after(() => {
		if (SIG) {
			return SIG.close();
		}
	});

});
