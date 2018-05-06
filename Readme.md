# Monero, Ripple & Stellar Integration

This repository includes all components needed to integrate 3 blockchains with API & SignService for each of them.
Basic structure of repository:
* `core` folder includes common to all blockchains functionality: configuration loading, logging, HTTP server, database abstractions and corresponding tests.
* each of blockchain folders (`monero`, `ripple`, `stellar`) with chain-specific logic;
* root folder also contains `Dockerfile` per each needed container (6 required + several optional like testnet for Monero).

## Overview

### Core

Core is responsible for setting up HTTP server and common among all blockchains environment. It also contains common abstract classes `Wallet` & `Tx` which are overridden for each of blockchains supported. 

* `index.js` loads configuration, sets up logging, conntects to db and starts HTTP server with specified endpoints.
* `index-api.js` provides default API endpoints, not specific to any blockchain. 
* `index-sign.js` does the same for SignService.  
* `tests.js` contains core tests: config loading, data validation, server lifecycle, etc.
* `test-chain.js` contains standard test suite for all blockchains and is being called from each blockchain `tests.js`.  

Booting process can be described in following steps:

1. Load configuration. Exit if failed, proceed if succeeded.
2. Connect to Mongodb if config has `store` prefefrence. Exit if failed, proceed if succeeded.
3. Start server with provided wallet implementation & extra endpoints specifications.
4. Gracefully shutdown on SIGHUP or other signals.

### Configuration

Below is contents of `test-config.json` which is used for tests of Monero API. All listed fields are required for API services. Other blockchains have very similar configuration files. Fields `Wallet***` can be also set in `SettingsUrl` and environment variables under the same names.

```
{
	"version": "0.0.1",
	"chain": "monero",
	"serviceName": "MoneroApiService",
	"port": 3000,
	"log": "debug",
	"testnet": true,
	"store": "mongodb://192.168.1.216:27017/lykke_test",
	"node": "http://192.168.1.216:28081",
	"assetId": "XMR_ASSET_ID",
	"assetName": "Monero",
	"assetOpKey": "monero",
	"assetAccuracy": 12,
	"refreshEach": 15000,
	"SeedView": "3b7e393e48ccedc23e555f293b88b3a6662471e42b79071ed9fd7a6333cbd302",
	"SeedSeed": "0569d304201515ac8f7af8276234b5c159514a2c97d2e17068bf0298adfe490a",
	"SeedAddress": "9yhHFUUZeARW6ecyHJe2ZARrWEHnifGLQK8tvKZVccVYNoeRKQp8rfDXGzWaJuGT4m3diT8gHGww9B5vwW92m2k91iMJTPM",
	"WalletAddress": "9zXxFrqsyjwGwFyWx3FQxM4Fe1XruVkNhP3FFHVuTBwtWU2dVoBaSbBFAF1GAwUgn82Xt1jqgQ8uFQffTAZnqe2L9ahmG7r",
	"WalletViewKey": "516cfb79ce2265f4b407293ff7b1cb219f13fe10ee15d264f7772f98fe5f7208"
}
```

Configuration is loaded with retries as required from URL specified `SettingsUrl` ENV variable.

### Logging

`log.js` in `core` folder is responsible for logging. It uses `watson` js logger with multiple outputs: file with name of `[BLOCKCHAIN]-error.log` for errors and stdout + azure table storage for all levels respective to logging level in configuration. When configuration is not loaded yet, output goes to `default-error.log` since we don't know blockchain name yet.


### Database

Mongodb is used for storage. DB URL is taken from `store` config preference. Standard db driver is used. `store.js` file contains db-related logic and corresponding abstractions as required. 2 collections are used: `transactions` for observed transactions, `accounts` for balances observing. Basic structure of records is following:

**transactions**: 

```
{ 
	"_id" : ObjectId("5a7f4d332d66cc54d35c6913"), 			// ID of transaction
	"opid" : "OPERATION_ID", 								// operation id
	"priority" : -1, 										// priority if any (extra parameter in POST /api/transactions/*)
	"unlock" : -1, 											// unlock period if any (extra parameter in POST /api/transactions/*)
	"operations" : [ 										// array of operations, that is payments or account creations (stellar-only)
		{ 
			"id" : '123', 									// id of operation (stellar only)
			"from" : "SENDER_ADDRESS",						// sender address, without paymentId
			"sourcePaymentId" : null,						// sender paymentId if any
			"to" : "RECIEVER_ADDRESS",						// receiver address, without paymentId
			"paymentId" : "fcffc182c4643e5f",				// receiver paymentId
			"asset" : "monero",								// asset code in blockchain terms
			"amount" : 8000000000000,						// amount as integer according to blockchain precision
			"fee" : 0,										// fee if any (0 for incoming transactions)
		} 
	], 
	"hash" : "823ca0197f1c8eef55078fe84346b1fb2e17fee6ef8e868936481f3f81ad5898", 	// tx hash or id
	"block" : 5023, 										// block when transaction was included in blockchain (or analog)
	"timestamp" : 1518292268000, 							// last modification timestamp (time from blockchain)
	"error" : null, 										// error if any, not used
	"status" : "locked" 									// internal status: initial, sent, locked (incoming not mature enough outputs), confirmed, failed
}
```

**accounts**:

```
{ 
	"_id" : "FULL_ADDRESS_WITH_PAYMENT_ID", 				// full account address, with paymentId
	"paymentId" : "9c86de421dec37db", 						// paymentId of this account, that is unique identifier (random blockchain-specific string)
	"balance" : 16000000000000, 							// account balance as integer according to blockchain precision
	"block" : 5686 											// last transaction block
}
```

`paymentId` is a unique string which identifies account transactions within one wallet. Monero uses 8-byte random, Stellar uses 14-byte random, Ripple uses 32-bit Integer random.
`paymentId` is included into `_id`, either implicitly (Monero, no special formatting required) or explicitly (by using simple format: "WALLETADDRESS+paymentId", where "+" is a separator which could be used in UI). Uniqueness of `paymentId` must be enforced externally through enforcing uniqueness of wallet address, that is `_id`. All cash-ins must be marked with corresponding `paymentId`:
* For Monero it's enough to send a payment to address equal to `_id`, thus it doesn't contain any separators.
* For Stellar & Ripple it's required to manually add a "memo" (Stellar) or "tag" (Ripple) to transaction in user's wallet application. This memo/tag must equal to a string following `+` in address' `_id`.

Following indexes are enforced:
	* `hash` unique & sparse index is enforced on `transactions` collection to ensure one tx per hash is recorded.
	* `opid` unique & sparse index is enforced on `transactions` collection, for performance reasons.
	* `paymentId` unique index is enforced on `accounts` collection, for performance reasons.

### HTTP Server

`koa.js` is used for middleware-style server implementation. All requests are logged (no body, only metod + path in INFO level & query + params in DEBUG level) & tagged with response time in `X-Response-Time` header. Request validation is standardized with `koa-bouncer`, thus whenever `ValidationError` exception is thrown by implementation, standard 400 response is generated by `core`'s `index.js` as required. Other exceptions are caught and result in 500 error.


### Tests

As a general rule, separate components are tested separately. `core` has tests for config loading, http server, db connectivity, etc. Each blockchain 
has integration tests (API + SignService) at its folder. Ingegration test is mostly standard and can be found at `core/tests-chain.js`. Monero has separate test suite for native component (`monero/xmr` folder). Wherever a file named `tests.js` is placed, tests can be run run with `npm test`.


### Code structure

Each blockchain folder has following files:
* `api.js` is a node.js entry point for API service.
* `sign.js` is a node.js entry point for SignService.
* `wallet.js` is a specific blockchain implementation including transactions construction, updates, validation, etc.
* `tests.js` file contains tests.


# Monero

**Glossary:**
* View wallet -- wallet which cannot sign transactions, it can only view incoming transfers and sometimes outgoing payments.
* Sign wallet -- wallet which can sign transactions, but doesn't see outputs or transactions because it's not connected to internet and doesn't have storage.
* Output -- generatly speaking public key of some specific amount of coins.
* Key image -- generaly speaking "signed" output which allows detection of whether output has been spent or not, prevents double spending in Monero.

Monero implentation is the most complicated of those 3 blockchains supported by this repository. It contains native C++ node.js module called `xmr` which is basically a modified wallet-cli v0.11.1.0 from [Monero repo](https://github.com/monero-project/monero). Modification is done by extending `tools::monero2` class by `tools::XMRWallet` class. To extend this class `wallet2.cpp` must be modified to have `protected` members instead of `private`. Thus `wallet2.cpp` must be compiled separately from `libwallet` and included in `monero/xmr/wallet` folder. `libwallet` is a shared library built by standard monero `make` (see `Dockerfile-monero-sign` for build process) required by native module at linking phase. Module building is done by standard `npm install` command through `node-gyp`.

Notable additions/changes of `XMRWallet` compared to standard `tools::wallet2` include:

* Spend wallets don't store data in files.
* Modified refreshing logic to rescan spent outputs more often to support long-running view & spend wallets separation.
* Modified from standard file-based data formats for unsigned transactions, outputs, key images & signed transactions. Implementation still uses `boost::serialization`, but adds `gzip` & `base64` encoding on top of custom data structures. Structures are custom to shift from exporting *all* outputs on each transaction to exporting only the ones which don't have key images yet. This dramatically decreases amounts of data.

Standard implementation: 
* export all outputs from view wallet [~5 MB];
* import all outputs to spend wallet [~5 MB];
* export key images from spend wallet [~2 MB];
* import key images to view wallet [~2 MB];
* export unsigned transaction from view wallet [dozens of kilobytes];
* import & sign unsigned transaction in spend wallet [dozens of kilobytes];
* export signed transaction from spend wallet [dozens of kilobytes];
* import & submit signed transaction from view wallet [dozens of kilobytes].

Data amounts above are from testnet of several thousands blocks & for hundreds to small thousands of outputs, therefore one can easily imagine actual amounts of data in production.

`XMRWallet` implementation with view wallet somewhat in sync:
* export unsigned transaction & new outputs from view wallet [dozens of kilobytes];
* import new outputs & unsigned transaction to spend wallet [dozens of kilobytes];
* export new key images & signed transaction from spend wallet [dozens of kilobytes];
* import new key images & signed transaction to view wallet [dozens of kilobytes].

At last stage `XMRWallet` tries to submit transaction. If daemon accepts it, we're good and have all the key images without need of second round of syncing as opposed to standard implementation. If daemon declines transaction (with double spend error due to unavailability of some of key images when creating transaction), view wallet will return error. Next time mediator would try to create this transaction, view wallet would already have key images in sync, thus transaction would succeed.

There is also a precaution feature - full sync. Sometimes, if wallet is near empty or after `sweep-all` command (which merges thousands of outputs into smaller number of big outputs), wallet goes into `sync required` mode. It means that next time mediator would try to send a transaction, all outputs would be exported from view wallet instead of unsigned transaction. Mediator won't know this fact and would process transaction as usual. 

* export all outputs from view wallet instead of unsigned transaction;
* import all outputs to spend wallet;
* export all key images from spend wallet;
* import all key images to view wallet.

At last stage, instead of submitting transaction, view wallet will return error. But next transaction would go fine since we have all key images in view wallet.

Bottomline: 
1. Optimized data formats:
  * Transferring unrelated outputs / key images along with unsigned / signed transaction, to keep view wallet in sync.
  * GZIP compression of data.
2. Support of operations made outside of API/SignService.
3. Keeping most of standard monero wallet logic, therefore ensuring ease of upgrades to future hard forks.


### Monero Configuration

`iartem/monero-testnet` docker image is available for use at Docker Hub. It creates 3-node test network which simplifies testing. See `monero/scripts.sh` for scripts to generate wallets (nodes mine into them) and docker startup command.

Example API configuration:

```
{
	// isalive
	"version": "0.0.1",
	"chain": "monero",
	"serviceName": "MoneroApiService",

	// port to bind to
	"port": 3001,

	// log level
	"log": "debug",

	// testnet flag
	"testnet": true,

	// mongodb url
	"store": "mongodb://192.168.1.216:27017/lykke_test_monero",

	// node url
	"node": "http://192.168.1.216:28081",

	// asset id to return in endpoints
	"assetId": "XMR_ASSET_ID",

	// isalive
	"assetName": "Monero",

	// asset key used in transactions (Stellar & Ripple)
	"assetOpKey": "monero",
	"assetAccuracy": 12,
	"refreshEach": 15000,
	"wallet": {
		"view": "805578055208faca04c977f77efc02db9eda17f78e0f17b7475df1bf30f5bc04",
		"address": "9ycSSr8QT2GL9GcWDJGW3jaGXnoNcN2PFLXprcqneVebFn2kGNPiLq8cxJrufqhCUq12rndThWegqiNbVzTK5YBFMf4rc8w"
	}
}
```


Example SignService configuration:

```
{
	"version": "0.0.1",
	"chain": "monero",
	"serviceName": "MoneroSignService",
	"port": 5001,
	"log": "debug",
	"testnet": true,
	"assetId": "XMR_ASSET_ID",
	"assetName": "Monero",
	"assetOpKey": "monero",
	"assetAccuracy": 12,
	"wallet": {
		"view": "805578055208faca04c977f77efc02db9eda17f78e0f17b7475df1bf30f5bc04",
		"address": "9ycSSr8QT2GL9GcWDJGW3jaGXnoNcN2PFLXprcqneVebFn2kGNPiLq8cxJrufqhCUq12rndThWegqiNbVzTK5YBFMf4rc8w"
	}
}
```


# Stellar & Ripple

These blockchains have very similar implementation: 
1. They support tagging transactions with some specific data.
2. They require so called *reserve* to be held on any account to be able to make outgoing transactions and other operations from it.

Therefore, for reasons other than Monero, yet one wallet scheme is preferred for these blockchains as well. 

Implementation for Stellar & Ripple is very similar to Monero implementation, with only one difference: Monero encodes `paymentId` into address, while Stellar & Ripple don't have such ability. For this reasons SignService returns addresses which look like `WALLETADDRESS+PAYMENTID`, where '+' is a separator.

Other than address encoding there is no differences from Monero.



