'use strict';
const config = {
	config: require('./defaults.json'),
	load: (settings) => {
		let obj = require('./defaults.json');

		return new Promise((resolve, reject) => {
			settings = settings || process.env.SettingsUrl || './defaults.json';

			if (!settings) {
				reject('No SettingsUrl ENV var set up');

			} else if (settings.indexOf('//') !== -1) {
				const Transport = require('./transport.js');
				let transport = new Transport({url: settings, retryPolicy:(error, attempts) => {
					return error === 'timeout' || (error === null && attempts < 3);
				}});
				transport.retriableRequest(null, 'GET', null, resp => {
					try {
						return typeof resp === 'string' ? JSON.parse(resp) : resp ? null : 'not a json response';
					} catch (e) {
						return 'not a json response';
					}
				}).then(json => {
					resolve(json);
				}, error => {
					require('./log.js')('config').error(`Cannot load SettingsUrl from ${settings} using HTTP, exiting`);
					reject(error);
				});

			} else {
				try {
					resolve(require(settings));
				} catch (e) {
					require('./log.js')('config').error(`Cannot load SettingsUrl from ${settings} using require, exiting`);
					reject(e);
				}
			}
			
		}).then((loaded) => {
			config.config = Object.assign({}, obj, loaded);
			if (loaded.logURL) {
				require('./log.js').setUpHTTP(loaded.serviceName, loaded.logURL);
			}
			require('./log.js').setLevel(config.config.log);
			return config.config;
		});
	}
};

module.exports = config;
