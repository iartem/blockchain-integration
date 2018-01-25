'use strict';

const index = (settings, routes) => {
	const log = require('../core/log.js'),
		L = log('index');

	return new Promise(resolve => {
		L.monitor('Starting up');
		
		require('../core/config.js').load(settings).then(async CFG => {
			process.on('SIGINT', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGINT)`);
				process.exit(0);
			});

			process.on('SIGTERM', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGTERM)`);
				process.exit(0);
			});

			process.on('SIGHUP', () => {
				L.monitor(`Terminating ${CFG.chain} (SIGHUP)`);
				process.exit(0);
			});

			process.on('uncaughtException', (err) => {
				L.error(`Uncaught exception ${err} ${err.stack}`);
				process.exit(1);
			});

			process.on('unhandledRejection', (err) => {
				L.error(`Unhandled rejection ${err} ${err.stack}`);
				process.exit(1);
			}); 

			let srv = {CFG: CFG, log: require('./log.js')};
			srv.log.setLevel(CFG.log);

			L.info('Connecting to store');
			let	Store = require('./store.js'),
				store = new Store(CFG, log);
			
			srv.store = await store.connect();
			L.info('Connected to store');
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
				jsonLimit: '1024kb'
			}));

			app.use(async (ctx, next) => {
				ctx.store = srv.store;
				ctx.CFG = srv.CFG;

				L.info(`request ${ctx.path}`)
				L.debug(`query ${JSON.stringify(ctx.query)} body ${JSON.stringify(ctx.request.body)} params ${JSON.stringify(ctx.params)}`);
				const start = Date.now();
				await next();
				const ms = Date.now() - start;
				ctx.set('X-Response-Time', `${ms}ms`);
				L.info(`request ${ctx.path} done with ${ctx.status} in ${ms}ms`);
			});

			app.use(async (ctx, next) => {
				try {
					await next();
				} catch (err) {
					ctx.status = 400;
					if (err.name === 'ValidationError') {
						ctx.body = {
							errorMessage: 'Validation Error',
							modelErrors: {
								[err.bouncer.key]: err.bouncer.message
							},
							trace: err.stack
						};
					} else if (err.name === 'XMRError') {
						ctx.body = {
							errorMessage: 'Monero error: ' + (err.message || 'Unknown error'),
							trace: err.stack
						};
					} else {
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

			let server = app.listen(CFG.port);

			srv.app = app;
			srv.server = server;
			srv.utils = require('./utils.js');
			srv.Validator = bouncer.Validator;
			srv.ValidationError = bouncer.ValidationError;

			srv.Validator.addMethod('isBoolean', function () {
				this.checkPred(val => val === false || val === true, 'must be a boolean');
				return this;
			});


			srv.close = () => {
				L.monitor(`Terminating ${CFG.chain} (close)`);
				srv.server.close();
				srv.store.close();
			};

			resolve(srv);
		}, err => {
			L.error(`Error on initialization: ${err}, won't start`);
			L.monitor(`Terminating (initialization error)`);
			process.exit(1);
		});
	});
};

module.exports = index;
