'use strict';

const GUID = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i');

const index = (settings, routes={}) => {
	const log = require('../core/log.js'),
		L = log('index');

	return new Promise(resolve => {
		L.monitor('Starting up');
		
		require('../core/config.js').load(settings).then(async CFG => {
			process.on('SIGINT', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGINT)`);
				setTimeout(process.exit.bind(process, 0), 1000);
			});

			process.on('SIGTERM', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGTERM)`);
				setTimeout(process.exit.bind(process, 0), 1000);
			});

			process.on('SIGHUP', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGHUP)`);
				setTimeout(process.exit.bind(process, 0), 1000);
			});

			process.on('uncaughtException', (err) => {
				L.error(err, 'Uncaught exception');
				setTimeout(process.exit.bind(process, 1), 1000);
			});

			process.on('unhandledRejection', (err) => {
				L.error(err, 'Unhandled rejection');
				setTimeout(process.exit.bind(process, 1), 1000);
			}); 

			let srv = {CFG: CFG, log: require('./log.js')};
			srv.log.setLevel(CFG.log);

			if ('store' in CFG) {
				L.info('Connecting to store');
				let	Store = require('./store.js'),
					store = new Store(CFG, log);
				
				srv.store = await store.connect();
				L.info('Connected to store');
			}

			return srv;
		}).then(srv => {
			const CFG = srv.CFG,
				Koa = require('koa'),
				koaBody = require('koa-body'),
				bouncer = require('koa-bouncer'),
				app = new Koa(),
				router = new require('koa-router')();
			
			L.monitor(`Starting ${CFG.chain}`);

			if (typeof CFG.port !== 'number') {
				L.monitor(`Terminating ${CFG.chain} (no port in configuration)`);
				process.exit(1);
			}

			app.use(bouncer.middleware());

			app.use(koaBody({
				jsonLimit: '10000kb'
			}));

			app.use(async (ctx, next) => {
				ctx.store = srv.store;
				ctx.CFG = srv.CFG;

				L.info(`request ${ctx.method} ${ctx.path}`);
				L.debug(`query ${JSON.stringify(ctx.query)} qs ${ctx.querystring} body ${JSON.stringify(ctx.request.body)} params ${JSON.stringify(ctx.params)}`);
				const start = Date.now();
				await next();
				const ms = Date.now() - start;
				ctx.set('X-Response-Time', `${ms}ms`);
				L.info(`request ${ctx.path} done with ${ctx.status} in ${ms}ms`);
				if (ctx.status === 400) {
					L.info(`response ${JSON.stringify(ctx.body)}`);
				}
			});

			app.use(async (ctx, next) => {
				try {
					await next();
				} catch (err) {
					ctx.status = 400;
					if (err.name === 'ValidationError') {
						if (err.bouncer.key === 'wallet') {
							ctx.status = 503;
							ctx.body = {
								errorCode: 'unknown',
								errorMessage: err.bouncer.message,
								trace: err.stack
							};
						} else if (err.bouncer.key) {
							ctx.body = {
								errorCode: 'unknown',
								errorMessage: 'Validation Error',
								modelErrors: {
									[err.bouncer.key]: [err.bouncer.message]
								},
								trace: err.stack
							};
						} else {
							ctx.body = {
								errorMessage: err.bouncer.message,
								trace: err.stack
							};
						}
					} else if (err.name === 'WalletError') {
						L.warn(err, 'WalletError in wrapper middleware');
						ctx.body = {
							errorCode: 'unknown',
							errorMessage: 'Wallet error: ' + (err.message || 'Unknown error'),
							trace: err.stack
						};
					} else {
						L.error(err, 'Server error in wrapper middleware');
						ctx.status = 500;
						ctx.body = {
							errorMessage: 'Server Error: ' + (err.message || JSON.stringify(err)),
							trace: err.stack
						};
					}
				}
			});

			router.get('/', ctx => {
				ctx.body = `Lykke ${CFG.chain} server`;
				ctx.status = 200;
			});

			['GET', 'POST', 'PUT', 'DELETE'].forEach(method => {
				let endpoints = routes[method];
				if (endpoints) {
					Object.keys(endpoints).forEach(path => {
						router[method.toLowerCase()](path, endpoints[path]);
					});
				}
			});

			app.use(router.routes())
				.use(router.allowedMethods());

			L.info(`Starting server on ${CFG.port}`);
			let server = app.listen(CFG.port);
			if (CFG.socketTimeout) {
				server.setTimeout(CFG.socketTimeout);
			}

			srv.app = app;
			srv.server = server;
			srv.utils = require('./utils.js');
			srv.Wallet = require('./wallet.js');
			srv.Validator = bouncer.Validator;
			srv.ValidationError = bouncer.ValidationError;

			srv.Validator.addMethod('isBoolean', function () {
				this.checkPred(val => val === false || val === true, 'must be a boolean');
				return this;
			});

			srv.Validator.addMethod('isGUID', function () {
				this.checkPred(val => typeof val === 'string' && GUID.test(val), 'must be a GUID');
				return this;
			});

			srv.Validator.addMethod('isTransactionContext', function () {
				this.checkPred(val => typeof val === 'string' && (val === srv.Wallet.Errors.NOPE_TX || val.length > 36), 'must be a valid transaction context');
				return this;
			});

			srv.close = async () => {
				L.monitor(`Terminating ${CFG.chain} (close)`);
				srv.server.close();
				if (srv.store) {
					srv.store.close();
				}
				await srv.utils.wait(500);
			};

			L.info(`Done starting chain ${CFG.chain}`);
			resolve(srv);
		}, err => {
			L.error(err, 'Error on initialization, won\'t start');
			L.monitor('Terminating (initialization error)');
			process.exit(1);
		});
	});
};

module.exports = index;
