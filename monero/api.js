// Uses standard endpoints, all differences are within Wallet implementation
var SRV;
let init = () => {
	return require('../core/index-api.js')(process.env.SettingsUrl, {
		GET: {
			'/api/balance': async ctx => {
				ctx.body = await SRV.wallet.balances();
			}
		},
		
		POST: {
		},

		DELETE: {
		},

		PUT: {
		}
	}, require('./wallet.js')).then(srv => SRV = srv);
};

module.exports = init();
module.exports.reset = init;
