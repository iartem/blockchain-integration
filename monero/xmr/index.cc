// hello.cc
#include <node.h>
#include "xmr.h"

namespace {

	using v8::Local;
	using v8::Object;

	// /**
	//  * Create new instance of XMR class - a parameter transforming wrapper around XMRWallet
	//  * 
	//  * @param {Boolean} testnet true if transaction is going to be run on testnet
	//  */
	// void CreateObject(const FunctionCallbackInfo<Value>& args) {
	// 	Isolate* isolate = args.GetIsolate();

	// 	Local<Object> obj = Object::New(isolate);
	// 	obj->Set(String::NewFromUtf8(isolate, "msg"), args[0]->ToString());

	// 	args.GetReturnValue().Set(obj);
	// }

	/**
	 * Generate wallet and return its keys
	 * 
	 * @param {Boolean} testnet true if transaction is going to be run on testnet
	 * @return {Array} of strings structured following way: ["spend key", "view key", "address", "mnemonic"]
	 */
	// void generateOfflineWallet(const FunctionCallbackInfo<Value>& args) {
	// 	Isolate* isolate = args.GetIsolate();
	// 	if (args.Length() != 1) {
	// 		// Throw an Error that is passed back to JavaScript
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong number of arguments")));
	// 		return;
	// 	}

	// 	// Check the argument types
	// 	if (!args[0]->IsBoolean()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong arguments")));
	// 		return;
	// 	}

	// 	// initialize wallet
	// 	tools::XMRWallet *m_wallet = new tools::XMRWallet(args[0]->BooleanValue());
	// 	XMRKeys keys = m_wallet->generateToMem("English");

	// 	Local<Array> ret = Array::New(isolate);
	// 	ret->Set(0, String::NewFromUtf8(isolate, keys.spend.c_str()));
	// 	ret->Set(1, String::NewFromUtf8(isolate, keys.view.c_str()));
	// 	ret->Set(2, String::NewFromUtf8(isolate, keys.address.c_str()));
	// 	ret->Set(3, String::NewFromUtf8(isolate, keys.mnemonics.c_str()));
	// 	// m_wallet->set_seed_language("English");

	// 	// // generate keys & secrets
	// 	// crypto::secret_key recovery_val, secret_key;
	// 	// try {
	// 	// 	recovery_val = m_wallet->generateToMem(path, password, secret_key, false, false);
	// 	// 	m_password = password;
	// 	// 	m_status = Status_Ok;
	// 	// } catch (const std::exception &e) {
	// 	// 	isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Error creating wallet: " << e.what())));
	// 	// 	return;
	// 	// }

	// 	// Handle<Boolean> testnet = Boolean::New(isolate, m_wallet->testnet());

	// 	args.GetReturnValue().Set(ret);
	// }

	/**
	 * Create new transaction and return its data as hex string. All parameters except for paymentId are required.
	 * 
	 * @param {Boolean} testnet true if transaction is going to be run on testnet
	 * @param {String} payment id if any, null otherwise
	 * @param {Array} destinations in form [[10000, 'address 1'], [20000, 'address 2']] numbers are amounts in atomic units, strings are addresses
	 * @param {Integer} priority 0-3 for: default, unimportant, normal, elevated, priority
	 * @param {Integer} unlock_time Number of blocks before the monero can be spent (0 to not add a lock)
	 * @param {Integer} mixin Number of outpouts from the blockchain to mix with (0 means no mixing)
	//  */
	// void prepareCashout (const FunctionCallbackInfo<Value>& args) {
	// 	Isolate* isolate = args.GetIsolate();
	// 	// Check number of arguments
	// 	if (args.Length() != 4) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong number of arguments")));
	// 		return;
	// 	}

	// 	Local<Array> destinations;

	// 	// Check the argument types
	// 	if (!args[0]->IsBoolean()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 0")));
	// 		return;
	// 	}
	// 	if (!args[1]->IsString() && !args[1]->IsNull()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 1")));
	// 		return;
	// 	}
	// 	if (!args[2]->IsArray()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 2")));
	// 		return;
	// 	} else {
	// 		destinations = Local<Array>::Cast(args[2]);
	// 		if (destinations->Length() == 0) {
	// 			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "destinations array cannot be empty")));
	// 			return;
	// 		}
	// 		if (!destinations->Get(0)->IsObject()) {
	// 			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "destinations array cannot be empty")));
	// 			return;
	// 		}
	// 	}
	// 	if (!args[3]->IsInt32()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 3")));
	// 		return;
	// 	}
	// 	if (!args[4]->IsInt32()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 4")));
	// 		return;
	// 	}
	// 	if (!args[5]->IsInt32()) {
	// 		isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Wrong type of argument 5")));
	// 		return;
	// 	}


	// 	bool testnet = args[0]->BooleanValue();

	// 	XMRDest dests[destinations->Length()];
	// 	for (uint32_t i = 0; i < destinations->Length(); i++) {
	// 		Local<Object> dest = Local<Object>::Cast(destinations->Get(i));
	// 		dests[i].address = std::string(*v8::String::Utf8Value(dest->Get(String::NewFromUtf8(isolate, "address"))));
	// 		dests[i].amount = dest->Get(String::NewFromUtf8(isolate, "amount"))->Uint32Value();
	// 	}

	// 	std::string paymentId;
	// 	if (args[1]->IsString()) {
	// 		paymentId = std::string(*v8::String::Utf8Value(args[1]->ToString()));
	// 	}

	// 	uint32_t priority = args[2]->Uint32Value();
	// 	uint32_t unlock_time = args[3]->Uint32Value();
	// 	uint32_t mixin = args[4]->Uint32Value();

	// 	tools::XMRWallet *m_wallet = new tools::XMRWallet(testnet);
	// 	XMRKeys keys = m_wallet->generateToMem("English");
	// }

	void InitAll(Local<Object> exports) {
		tools::XMR::Init(exports);
	}

	NODE_MODULE(NODE_GYP_MODULE_NAME, InitAll)

}  // namespace