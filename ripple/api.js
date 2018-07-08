// Uses standard endpoints, all differences are within Wallet implementation
let init = () => {
	return require('../core/index-api.js')(process.env.SettingsUrl, {
		GET: {
			'/api/isalive': ctx => {
				ctx.body = {
					Name: "Lykke.Service.RippleApi",
					Version: "1.0.0",
	  				Env: process.env.ENV_INFO || null,
	  				IsDebug: false,  
	  				IssueIndicators: []
				};
			},
		},
		
		POST: {
		},

		DELETE: {
		},

		PUT: {
		}
	}, require('./wallet.js'));
};

module.exports = init();
module.exports.reset = init;
