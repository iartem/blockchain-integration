/* eslint-env mocha */

const should = require('should'),
	nock = require('nock'),
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
	});

	it('should load config from file successfully', async () => {
		const config = await require('./config.js').load(__dirname + '/test-config.json');
		should.not.exist(config._id);
		should.exist(config.log);
		should.exist(config.chain);
		should.exist(config.port);
		config.log.should.equal('test');
		config.chain.should.equal('core');
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

describe('server', () => {
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
					
					let ok = await ctx.store.set(key, value);
					ok = await ctx.store.get(key);

					ctx.status = ok === value ? 200 : 400;
					ctx.body = {ok: ctx.status === 200};

					await ctx.store.del(key);
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
				}
			}
		}).then(async srv => {
			try {
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
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {name: 'name body parameter is required'}});

				await request.post('/post/not-a-number/observe')
					.send({name: 'test'})
					.expect('Content-Type', 'application/json; charset=utf-8')
					.expect(400, {errorMessage: 'Validation Error', modelErrors: {id: 'id url parameter must be a number'}});

				await request.delete('/no-such-endpoint')
					.expect(404);

			} finally {
				srv.close();
			}

		}, (err) => {
			should.fail(err);
		});
	});
});

