/* eslint-env mocha */

const should = require('should'),
	supertest = require('supertest');

process.env.SettingsUrl = __dirname + '/test-config.json';

describe('SignService', () => {
	var SRV, request;
	it ('should start server', () => {
		return require('./index.js').then(srv => {
			SRV = srv;
			request = supertest(SRV.server);
		});
	}).timeout(15000);

	it ('should return welcome message on /', async () => {
		await request.get('/')
			.expect('Content-Type', 'text/plain; charset=utf-8')
			.expect(200, `Lykke ${SRV.CFG.chain} server`);
	});

	it ('should return correct alive message on /api/isalive', async () => {
		let defaults = require('./test-config.json');

		await request.get('/api/isalive')
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200, {name: defaults.serviceName, version: defaults.version, env: null, isDebug: defaults.testnet});
	});

	it ('should return new wallet on /api/generate', async () => {
		await request.get('/api/generate')
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200)
			.then(res => {
				should.exist(res.body.spend);
				res.body.spend.should.not.be.empty();
				should.exist(res.body.mnemonics);
				res.body.mnemonics.should.not.be.empty();
				should.exist(res.body.view);
				res.body.view.should.not.be.empty();
				should.exist(res.body.address);
				res.body.address.should.not.be.empty();
			}, err => should.fail(err));
	});

	it ('should return new random address on /api/wallets', async () => {
		await request.post('/api/wallets')
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200)
			.then(res => {
				should.exist(res.body.publicAddress);
				res.body.publicAddress.should.not.be.empty();
			}, err => should.fail(err));
	});

	it ('should return specific address on /api/wallets if payment id is specified', async () => {
		await request.post('/api/wallets')
			.send({paymentId: '45d916d3fff755f2'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(200)
			.then(res => {
				should.exist(res.body.publicAddress);
				res.body.publicAddress.should.equal('A4rQ7m5VseR4ghrdUL35m5PQcJV69YF8731DSTDoh7pDgkBWz2LWNzncq7M5s1ARjPRhvGPX4dBUeC3xNj4wzfrjihG1j65czzGULZooRY');
			}, err => should.fail(err));
	});

	it ('should return error if paymentId is wrong on /api/wallets', async () => {
		await request.post('/api/wallets')
			.send({paymentId: 'invalid'})
			.expect('Content-Type', 'application/json; charset=utf-8')
			.expect(400)
			.then(res => {
				should.exist(res.body.errorMessage);
				should.exist(res.body.modelErrors);
				should.exist(res.body.modelErrors.paymentId);
				res.body.modelErrors.paymentId.should.equal('invalid payment id');
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
				res.body.modelErrors.paymentId.should.equal('must be a string');
			}, err => should.fail(err));
	});

	after(() => {
		if (SRV) {
			SRV.close();
		}
	});

});