// Uses standard endpoints, all differences are within Wallet implementation
let init = () => {
	return require('../core/index-sign.js')(process.env.SettingsUrl, {}, require('./wallet.js'));
};

module.exports = init();
module.exports.reset = init;
