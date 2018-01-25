/* eslint-env mocha */

const should = require('should'),
	supertest = require('supertest');

process.env.SettingsUrl = __dirname + '/test-config.json';

const DATA = {
	A0: '9u9j6xG1GNu4ghrdUL35m5PQcJV69YF8731DSTDoh7pDgkBWz2LWNzncq7M5s1ARjPRhvGPX4dBUeC3xNj4wzfrjV6SY3e9',
	A1: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhQwACVfSrmYCBepqKq',
	A2: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhRDQUa1nBfhE9NRPz4',
	A3: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhMfdfmNo3AbKGfPh2N',
	A4: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhSQJ657i8oJ57svdDU',
	A5: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhMvDUhdqtnWU9AcqCB',
	A6: 'ABBpFJS8MQ723FWPQooHaAibzjqPdvmP7RFj6u2wwnD8DvyXpqECf3Mby3GTLPjh7dgCj1d3D97KwZGnKiLkwWZmhPEjVJRHE3d5upo3wn',
	AX: 'A4rQ7m5VseR4ghrdUL35m5PQcJV69YF8731DSTDoh7pDgkBWz2LWNzncq7M5s1ARjPRhvGPX4dBUeC3xNj4wzfrjijE1JdtH8R3677AHfx',

	T1: 't1',
	T2: 't2',
	TX: 'tx'
};

// function detachWalletFromNode(wallet) {
// 	wallet.connect = () => true;
// 	wallet.connected = () => true;
// 	wallet.refresh = () => true;
// 	wallet.balances = () => {
// 		return {balance: 1000 * 1e12 + '', unlocked: 500 * 1e12 + ''};
// 	};

// 	wallet.createUnsignedTransaction = (tx) => {
// 		return JSON.stringify(tx);
// 	};
// 	wallet.signTransaction = (data) => {
// 		return data;
// 	};
// 	wallet.submitSignedTransaction = (data) => {
// 		try {
// 			let tx = JSON.parse(data);
// 		} catch (e) {
// 			throw new Error('Invalid tx data');
// 		}

// 		return {
// 			id: '123',
// 			amount: tx.destinations[0].amount + '',
// 			fee: tx.destinations[0].amount / 100 + '',
			
// 		};
// 	};
// }

describe('API', () => {
	var API, request;
	it('should start server', () => {
		return require('./index.js').then(srv => {
			API = srv;
			request = supertest(API.server);

			return srv.store.redis.flushdb();
		});
	}).timeout(15000);

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
				.expect(200, {name: defaults.serviceName, version: defaults.version, env: null, isDebug: defaults.testnet});
		});
	});

	describe('assets', () => {
		it('should return array of assets', () => {
			return request.get('/api/assets?take=10')
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {continuation: null, items: [{assetId: API.CFG.assetId, address: '', name: API.CFG.assetName, accuracy: 12}]});
		});
		it('should return asset by id', () => {
			return request.get(`/api/assets/${API.CFG.assetId}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {assetId: API.CFG.assetId, address: '', name: API.CFG.assetName, accuracy: 12});
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
			return request.get(`/api/addresses/${DATA.A0.replace('1', 'x')}/validity`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isValid: false});
		});
		it('should return failure if valid integrated address is provided', () => {
			return request.get(`/api/addresses/${DATA.A1.replace('1', 'x')}/validity`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200, {isValid: false});
		});
	});

	describe('address monitoring', () => {
		describe('empty balances', () => {
			
			it('should return error with no params', () => {
				return request.get('/api/balances')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: 'is required'}});
			});
			
			it('should return error with take=0', () => {
				return request.get('/api/balances?take=0')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: 'must be greater than 0'}});
			});
			
			it('should return error with take=100000', () => {
				return request.get('/api/balances?take=100000')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {take: 'must be less than 1000'}});
			});
			
			it('should return error with invalid continuation', () => {
				return request.get('/api/balances?take=100&continuation=asfd')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {continuation: 'must be a number'}});
			});
			
			it('should return empty list with take=100', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});
			
		});

		describe('address observation', () => {
			it('should return error if address with invalid characters provided', () => {
				return request.post('/api/balances/asd***/observation')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {address: 'is not valid monero address'}});
			});
			it('should return error if address with invalid length provided', () => {
				return request.post('/api/balances/555aaa/observation')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {address: 'must be of length 95 or 106'}});
			});
			it('should return error if address with invalid character of correct length', () => {
				return request.post('/api/balances/*u9j6xG1GNu4ghrdUL35m5PQcJV69YF8731DSTDoh7pDgkBWz2LWNzncq7M5s1ARjPRhvGPX4dBUeC3xNj4wzfrjV6SY3e9/observation')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {address: 'is not valid monero address'}});
			});
		});

		describe('address observation', () => {
			it('should successfully obvserve A1-A6', () => {
				return Promise.all([
					request.post(`/api/balances/${DATA.A1}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A2}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A3}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A4}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A5}/observation`).expect(200),
					request.post(`/api/balances/${DATA.A6}/observation`).expect(200)
				]);
			});

			it('should still return [] on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});

			it('should manuall write balances to redis for A2-A5', async () => {
				let set = await API.store.zadd('balances', 10, DATA.A2);
				set.should.equal(0);

				set = await API.store.zadd('balances', 5, DATA.A3);
				set.should.equal(0);

				set = await API.store.zadd('balances', 12, DATA.A4);
				set.should.equal(0);

				set = await API.store.zadd('balances', 11, DATA.A5);
				set.should.equal(0);
			});

			it('should now return 4 items on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.A3, assetId: API.CFG.assetId, balance: '5'},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: '10'},
						{address: DATA.A5, assetId: API.CFG.assetId, balance: '11'},
						{address: DATA.A4, assetId: API.CFG.assetId, balance: '12'},
					]});
			});

			it('should return 3 items & continuation on /api/balances with take=3', () => {
				return request.get('/api/balances?take=3')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: 3, items: [
						{address: DATA.A3, assetId: API.CFG.assetId, balance: '5'},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: '10'},
						{address: DATA.A5, assetId: API.CFG.assetId, balance: '11'},
					]});
			});

			it('should return 3 items & continuation on /api/balances with take=3 & empty continuation', () => {
				return request.get('/api/balances?take=3&continuation=')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: 3, items: [
						{address: DATA.A3, assetId: API.CFG.assetId, balance: 5},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: 10},
						{address: DATA.A5, assetId: API.CFG.assetId, balance: 11},
					]});
			});

			it('should return 1 item & no continuation on /api/balances with take=3&continuation=3', () => {
				return request.get('/api/balances?take=3&continuation=3')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.A4, assetId: API.CFG.assetId, balance: 12},
					]});
			});

			it('should return 0 items & no continuation on /api/balances with take=3&continuation=4', () => {
				return request.get('/api/balances?take=3&continuation=4')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: []});
			});

			it('should return error items on /api/balances with take=3&continuation=0', () => {
				return request.get('/api/balances?take=3&continuation=0')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {continuation: 'must be greater than 0'}});
			});

			it('should successfully delete A5 from observation list', () => {
				return request.delete(`/api/balances/${DATA.A5}/observation`)
					.expect(200);
			});

			it('should return error on deletion of non-existent AX', () => {
				return request.delete(`/api/balances/${DATA.AX}/observation`)
					.expect(204);
			});

			it('should now return only 3 items on /api/balances', () => {
				return request.get('/api/balances?take=100')
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(200, {continuation: null, items: [
						{address: DATA.A3, assetId: API.CFG.assetId, balance: '5'},
						{address: DATA.A2, assetId: API.CFG.assetId, balance: '10'},
						{address: DATA.A4, assetId: API.CFG.assetId, balance: '12'},
					]});
			});
		});
	});

	describe('transaction validation', () => {
		it('should return error if no operationId provided', () => {
			return request.post('/api/transactions')
				.send({
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {operationId: 'is required'}});
		});
		it('should return error if operationId is not a string', () => {
			return request.post('/api/transactions')
				.send({
					operationId: false, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {operationId: 'must be a string'}});
		});
		it('should return error if no fromAddress provided', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {fromAddress: 'is required'}});
		});
		it('should return error if fromAddress is invalid', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: '123', 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {fromAddress: 'must be of length 95 or 106'}});
		});
		it('should return error if no toAddress provided', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {toAddress: 'is required'}});
		});
		it('should return error if toAddress is invalid', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: '123', 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {toAddress: 'must be of length 95 or 106'}});
		});
		it('should return error if no assetId provided', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {assetId: 'is required'}});
		});
		it('should return error if assetId is not valid', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: '123', 
					amount: 10, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {assetId: 'must be equal to "monero"'}});
		});
		it('should return error if no amount provided', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {amount: 'is required'}});
		});
		it('should return error if amount is invalid', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 'not valid', 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {amount: 'must be an integer'}});
		});
		it('should return error if amount is too small', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 0, 
					includeFee: false
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {amount: 'is too small'}});
		});
		it('should return error if amount is too big', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 1000, 
					includeFee: false
				})
				.expect(406);
		});
		it('should return error if no includeFee provided', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {includeFee: 'is required'}});
		});
		it('should return error if includeFee is not boolean', () => {
			return request.post('/api/transactions')
				.send({
					operationId: DATA.T1, 
					fromAddress: DATA.A0, 
					toAddress: DATA.A1, 
					assetId: API.CFG.assetId, 
					amount: 10, 
					includeFee: 'not a boolean'
				})
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(400, {errorMessage: 'Validation Error', modelErrors: {includeFee: 'must be a boolean'}});
		});
	});
	
	describe('transaction handling', () => {
		var T1, T2, TX;

		it('should successfully obvserve T1-T2', () => {
			T1 = {operationId: DATA.T1, fromAddress: DATA.A0, toAddress: DATA.A1, assetId: API.CFG.assetId, amount: 11, includeFee: false};
			T2 = {operationId: DATA.T2, fromAddress: DATA.A0, toAddress: DATA.A2, assetId: API.CFG.assetId, amount: 12, includeFee: false};
			TX = {operationId: DATA.TX, fromAddress: DATA.A0, toAddress: DATA.AX, assetId: API.CFG.assetId, amount: 13, includeFee: false};
			return Promise.all([
				request.post('/api/transactions').send(T1).expect(200),
				request.post('/api/transactions').send(T2).expect(200),
				request.post('/api/transactions').send(TX).expect(200),
			]);
		});

		it('should not return T1 - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/${DATA.T1}`)
				.expect(204);
		});
		it('should not return T2 - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/${DATA.T2}`)
				.expect(204);
		});
		it('should not return TX (self to self) - not broadcasted yet', () => {
			return request.get(`/api/transactions/broadcast/${DATA.TX}`)
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
			return request.get(`/api/transactions/broadcast/${DATA.T2}`)
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
			return request.get(`/api/transactions/broadcast/${DATA.T1}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.state);
					should.exist(res.body.operationId);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.error);
					res.body.state.should.equal(T1.state);
					res.body.operationId.should.equal(T1.operationId);
					res.body.amount.should.equal(T1.amount + '');
					res.body.fee.should.equal('1');
					T1 = res.body;
				});
		});
		it('should return T2', () => {
			T2.state = 'inProgress';
			return request.get(`/api/transactions/broadcast/${DATA.T2}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.state);
					should.exist(res.body.operationId);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.error);
					res.body.state.should.equal(T2.state);
					res.body.operationId.should.equal(T2.operationId);
					res.body.amount.should.equal(T2.amount + '');
					res.body.fee.should.equal('1');
					T2 = res.body;
				});
		});

		it('should return TX (self to self) with state completed', () => {
			TX.state = 'completed';
			return request.get(`/api/transactions/broadcast/${DATA.TX}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200)
				.expect(res => {
					should.exist(res.body.state);
					should.exist(res.body.operationId);
					should.exist(res.body.timestamp);
					should.exist(res.body.amount);
					should.exist(res.body.fee);
					should.exist(res.body.hash);
					should.not.exist(res.body.error);
					res.body.state.should.equal(TX.state);
					res.body.operationId.should.equal(TX.operationId);
					res.body.amount.should.equal(TX.amount + '');
					res.body.fee.should.equal('1');
					TX = res.body;
				});
		});

		it('should successfully delete T1 from observation list', () => {
			return request.delete(`/api/transactions/broadcast/${DATA.T1}`)
				.expect(200);
		});
		it('should not return T1 - deleted', () => {
			return request.get(`/api/transactions/broadcast/${DATA.T1}`)
				.expect(204);
		});
		it('should still return T2', () => {
			return request.get(`/api/transactions/broadcast/${DATA.T2}`)
				.expect('Content-Type', 'application/json; charset=utf-8')
				.expect(200);
		});

		it('should successfully delete T2 from observation list', () => {
			return request.delete(`/api/transactions/broadcast/${DATA.T2}`)
				.expect(200);
		});
		it('should not return T2 - deleted', () => {
			return request.get(`/api/transactions/broadcast/${DATA.T2}`)
				.expect(204);
		});
	});

	after(() => {
		if (API) {
			// API.store.redis.flushdb();
			API.close();
		}
	});

});