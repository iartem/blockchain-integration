#include "xmr.h"
#include "boost/none_t.hpp"
#include "string_coding.h"

inline void NODE_SET_INSTANCE_METHOD(v8::Local<v8::FunctionTemplate> recv,
                                      const char* name,
                                      v8::FunctionCallback callback) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Signature> s = v8::Signature::New(isolate, recv);
  v8::Local<v8::FunctionTemplate> t =
      v8::FunctionTemplate::New(isolate, callback, v8::Local<v8::Value>(), s);
  v8::Local<v8::String> fn_name = v8::String::NewFromUtf8(isolate, name);
  t->SetClassName(fn_name);
  recv->InstanceTemplate()->Set(fn_name, t);
}

namespace tools {

	using v8::Context;
	using v8::Exception;
	using v8::Function;
	using v8::FunctionCallbackInfo;
	using v8::FunctionTemplate;
	using v8::Isolate;
	using v8::Local;
	using v8::Number;
	using v8::Integer;
	using v8::Boolean;
	using v8::Object;
	using v8::Array;
	using v8::Persistent;
	using v8::String;
	using v8::Value;
	using v8::Handle;

	Persistent<Function> XMR::constructor;

	/**
	 * Class wich transforms data from v8 to monero and back. 
	 * Also contains some retrying logic 
	 */
	XMR::XMR(bool testnet, std::string daemon, bool ssl) {
		this->wallet = new tools::XMRWallet(testnet);
		this->daemon = daemon;
		this->ssl = ssl;
	}

	XMR::~XMR() {
		this->onTx.Reset();
		this->onBlock.Reset();
	}


	void XMR::Init(Local<Object> exports) {
		Isolate* isolate = exports->GetIsolate();

		// Prepare constructor template
		Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);
		tpl->SetClassName(String::NewFromUtf8(isolate, "XMR"));
		tpl->InstanceTemplate()->SetInternalFieldCount(1);

		// Prototype
		NODE_SET_PROTOTYPE_METHOD(tpl, "testnet", testnet);
		NODE_SET_PROTOTYPE_METHOD(tpl, "address", address);
		NODE_SET_METHOD((Local<v8::Template>)tpl, "addressDecode", addressDecode);
		NODE_SET_METHOD((Local<v8::Template>)tpl, "addressEncode", addressEncode);
		NODE_SET_PROTOTYPE_METHOD(tpl, "connect", connect);
		NODE_SET_PROTOTYPE_METHOD(tpl, "disconnect", disconnect);
		NODE_SET_PROTOTYPE_METHOD(tpl, "connected", connected);
		NODE_SET_PROTOTYPE_METHOD(tpl, "refresh", refresh);
		NODE_SET_PROTOTYPE_METHOD(tpl, "refresh_and_store", refresh_and_store);
		NODE_SET_PROTOTYPE_METHOD(tpl, "close", close);
		NODE_SET_PROTOTYPE_METHOD(tpl, "store", store);
		NODE_SET_PROTOTYPE_METHOD(tpl, "rescan", rescan);
		NODE_SET_PROTOTYPE_METHOD(tpl, "balances", balances);
		NODE_SET_PROTOTYPE_METHOD(tpl, "height", height);
		NODE_SET_PROTOTYPE_METHOD(tpl, "cleanup", cleanup);
		NODE_SET_PROTOTYPE_METHOD(tpl, "createIntegratedAddress", createIntegratedAddress);
		NODE_SET_METHOD((Local<v8::Template>)tpl, "createPaperWallet", createPaperWallet);
		NODE_SET_PROTOTYPE_METHOD(tpl, "openPaperWallet", openPaperWallet);
		NODE_SET_PROTOTYPE_METHOD(tpl, "openViewWallet", openViewWallet);
		NODE_SET_PROTOTYPE_METHOD(tpl, "openViewWalletOffline", openViewWalletOffline);
		NODE_SET_PROTOTYPE_METHOD(tpl, "setCallbacks", setCallbacks);
		NODE_SET_PROTOTYPE_METHOD(tpl, "createUnsignedTransaction", createUnsignedTransaction);
		NODE_SET_PROTOTYPE_METHOD(tpl, "signTransaction", signTransaction);
		NODE_SET_PROTOTYPE_METHOD(tpl, "submitSignedTransaction", submitSignedTransaction);
		NODE_SET_PROTOTYPE_METHOD(tpl, "exportOutputs", exportOutputs);
		NODE_SET_PROTOTYPE_METHOD(tpl, "transactions", transactions);
		NODE_SET_PROTOTYPE_METHOD(tpl, "testIt", testIt);

		constructor.Reset(isolate, tpl->GetFunction());
		exports->Set(String::NewFromUtf8(isolate, "XMR"), tpl->GetFunction());
	}

	void XMR::New(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();

		if (args.Length() != 3 || !args[0]->IsBoolean() || !args[1]->IsString() || !args[2]->IsBoolean()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: bool testnet, string daemon URL, bool ssl")));
			return;
		}

		if (!args.IsConstructCall()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Must be invoked as constructor")));
			return;
		}

		bool testnet = args[0]->BooleanValue();
		std::string daemon(*v8::String::Utf8Value(args[1]->ToString()));
		bool ssl = args[2]->BooleanValue();

		XMR* obj = new XMR(testnet, daemon, ssl);
		obj->Wrap(args.This());
		args.GetReturnValue().Set(args.This());
	}

	/**
	 * Generate wallet and return its fees
	 * 
	 * @param {String} language mnemonic language
	 * @return {Array} of strings structured following way: ["spend key", "view key", "address", "mnemonic"]
	 */
	void XMR::createPaperWallet(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		
		if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsBoolean()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string lang, bool testnet")));
			return;
		}

		XMRKeys keys = tools::XMRWallet::createPaperWallet(std::string(*v8::String::Utf8Value(args[0]->ToString())), args[1]->BooleanValue());

		Local<Array> ret = Array::New(isolate);
		ret->Set(0, String::NewFromUtf8(isolate, keys.spend.c_str()));
		ret->Set(1, String::NewFromUtf8(isolate, keys.view.c_str()));
		ret->Set(2, String::NewFromUtf8(isolate, keys.address.c_str()));
		ret->Set(3, String::NewFromUtf8(isolate, keys.mnemonics.c_str()));

		args.GetReturnValue().Set(ret);
	}

	/**
	 * Create integrated address: 
	 * @param args [description]
	 */
	void XMR::createIntegratedAddress(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		std::string paymentId;
		if (args.Length() != 1 || (!args[0]->IsNullOrUndefined() && !args[0]->IsString())) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: either nothing, or string paymentId")));
			return;
		} else {
			if (!args[0]->IsNullOrUndefined()) {
				paymentId = *v8::String::Utf8Value(args[0]->ToString());
			}
			args.GetReturnValue().Set(String::NewFromUtf8(isolate, xmr->wallet->createIntegratedAddress(paymentId).c_str()));
		}
	}

	void XMR::openPaperWallet(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsString()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string address, string seed")));
			return;
		}

		std::string spendKey(*v8::String::Utf8Value(args[1]->ToString()));

		if (!xmr->wallet->openPaperWallet(spendKey)) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Cannot open wallet from spendKey: invalid key provided")));
			return;
		}
	}

	void XMR::openViewWallet(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsString()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string address, string viewKey")));
			return;
		}

		std::string address(*v8::String::Utf8Value(args[0]->ToString()));
		std::string viewKey(*v8::String::Utf8Value(args[1]->ToString()));

		int code = xmr->wallet->openViewWallet(address, viewKey);
		if (code == 0) {
			return;
		} else if (code == -1) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Invalid address")));
		} else if (code == -2) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Invalid viewKey")));
		} else if (code == -3) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Failed to store wallet files")));
		}
	}


	void XMR::openViewWalletOffline(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsString()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string address, string viewKey")));
			return;
		}

		std::string address(*v8::String::Utf8Value(args[0]->ToString()));
		std::string viewKey(*v8::String::Utf8Value(args[1]->ToString()));

		int code = xmr->wallet->openViewWalletOffline(address, viewKey);
		if (code == 0) {
			return;
		} else if (code == -1) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Invalid address")));
		} else if (code == -2) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Invalid viewKey")));
		}
	}

	void XMR::setCallbacks(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 2 || !args[0]->IsFunction() || !args[1]->IsFunction()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: function onTx, function onBlock")));
			return;
		}

		xmr->onTx.Reset(isolate, Local<Function>::Cast(args[0]));
		xmr->onBlock.Reset(isolate, Local<Function>::Cast(args[1]));
		xmr->wallet->callback(xmr);
	}

	void XMR::address(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		std::string address = obj->wallet->address();
		args.GetReturnValue().Set(String::NewFromUtf8(isolate, address.c_str()));
	}

	void XMR::addressDecode(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();

		if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsBoolean()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string address, bool testnet")));
			return;
		}

		std::string address = *v8::String::Utf8Value(args[0]->ToString());
		bool testnet = args[1]->BooleanValue();
		XMRAddress addr = tools::XMRWallet::addressDecode(address, testnet);

		Local<Array> ret = Array::New(isolate);

		if (!addr.address.empty()) {
			ret->Set(0, String::NewFromUtf8(isolate, addr.address.c_str()));
			ret->Set(1, String::NewFromUtf8(isolate, addr.payment_id.c_str()));
		}

		args.GetReturnValue().Set(ret);
	}

	void XMR::addressEncode(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();

		if (args.Length() != 3 || !args[0]->IsString() || !args[1]->IsString() || !args[2]->IsBoolean()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required arguments: string address, string paymentId, bool testnet")));
			return;
		}

		std::string address = *v8::String::Utf8Value(args[0]->ToString());
		std::string paymentId = *v8::String::Utf8Value(args[1]->ToString());
		bool testnet = args[2]->BooleanValue();
		std::string encoded = tools::XMRWallet::addressEncode(address, paymentId, testnet);

		args.GetReturnValue().Set(String::NewFromUtf8(isolate, encoded.c_str()));
	}

	void XMR::testnet(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->testnet()));
	}

	void XMR::connect(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		bool connected = obj->wallet->init(obj->daemon, boost::none);
		args.GetReturnValue().Set(Boolean::New(isolate, connected));
	}

	void XMR::disconnect(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->disconnect()));
	}

	void XMR::cleanup(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->cleanup()));
	}

	void XMR::connected(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		uint32_t version = 0;
		uint32_t timeout = 10;
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->check_connection(&version, timeout)));
	}

	void XMR::refresh(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		bool refreshed;
		std::string error = obj->wallet->refresh(refreshed);
		if (error.empty()) {
			args.GetReturnValue().Set(Boolean::New(isolate, refreshed));
		} else {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, (std::string("Error while refreshing") + error).c_str())));
		}
	}

	void XMR::refresh_and_store(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->refresh_and_store()));
	}

	void XMR::close(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		args.GetReturnValue().Set(Boolean::New(isolate, obj->wallet->close()));
	}

	void XMR::store(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		try {
			obj->wallet->store();
			args.GetReturnValue().Set(Boolean::New(isolate, true));
		} catch (...) {
			args.GetReturnValue().Set(Boolean::New(isolate, false));
		}
	}

	void XMR::rescan(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());
		obj->wallet->rescan_blockchain(true);
		obj->wallet->rescan_spent();
		args.GetReturnValue().Set(Boolean::New(isolate, true));
	}

	void XMR::balances(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());

		uint64_t balance = 0, unlocked = 0;
		obj->wallet->balances(balance, unlocked);

		Local<Object> ret = Object::New(isolate);
		ret->Set(String::NewFromUtf8(isolate, "balance"), String::NewFromUtf8(isolate, int64ToStr(balance).c_str()));
		ret->Set(String::NewFromUtf8(isolate, "unlocked"), String::NewFromUtf8(isolate, int64ToStr(unlocked).c_str()));
		args.GetReturnValue().Set(ret);
	}

	void XMR::height(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* obj = ObjectWrap::Unwrap<XMR>(args.Holder());

		args.GetReturnValue().Set(String::NewFromUtf8(isolate, int64ToStr(obj->wallet->nodeHeight()).c_str()));
	}

	void XMR::exportOutputs(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());
	
		Local<Object> ret = Object::New(isolate);

		std::string outputs;
		std::string error = xmr->wallet->exportOutputs(outputs);

		if (isError(error)) {
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		} else {
			ret->Set(String::NewFromUtf8(isolate, "outputs"), String::NewFromUtf8(isolate, encodeBase64(outputs).c_str()));
		}

		args.GetReturnValue().Set(ret);
	}

	void XMR::createUnsignedTransaction(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 2 || !args[0]->IsObject() || !args[1]->IsBoolean()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required argument: Tx instance, bool optimized")));
			return;
		}

		XMRTx tx;

		Local<Context> context = isolate->GetCurrentContext();
		Local<Object> obj = args[0]->ToObject(context).ToLocalChecked();
		bool optimized = args[1]->BooleanValue();
		tx.priority = obj->Get(String::NewFromUtf8(isolate, "priority"))->Int32Value();
		tx.mixins = obj->Get(String::NewFromUtf8(isolate, "mixins"))->Int32Value();
		tx.unlock_time = obj->Get(String::NewFromUtf8(isolate, "unlock"))->Int32Value();

		if (!obj->Get(String::NewFromUtf8(isolate, "paymentId"))->IsNullOrUndefined()) {
			tx.payment_id = std::string(*v8::String::Utf8Value(obj->Get(String::NewFromUtf8(isolate, "paymentId"))->ToString()));
		}

		// logstream << "priority " << tx.priority << ", mixins " << tx.mixins << ", unlock_time " << tx.unlock_time << EOL;

		Handle<Array> array = Handle<Array>::Cast(obj->Get(String::NewFromUtf8(isolate, "destinations")));
		for (uint32_t i = 0; i < array->Length(); i++) {
			Handle<Array> destination = Handle<Array>::Cast(array->Get(i));
			std::string amount(*v8::String::Utf8Value(destination->Get(0)->ToString()));
			std::string address(*v8::String::Utf8Value(destination->Get(1)->ToString()));
			XMRDest dest;
			dest.address = address;
			dest.amount = strToInt64(amount);
			tx.destinations.push_back(dest);
			// logstream << "destination" << i << ": amount " << dest.amount << ", address " << dest.address << EOL;
			// logstream << "destination" << i << ": " << amount << EOL;
			// logstream << "destination" << i << ": " << strToInt64(amount) << EOL;
		}
 	
		Local<Object> ret = Object::New(isolate);

		std::string data;
		std::string error = xmr->wallet->createUnsignedTransaction(data, tx, optimized);

		if (isError(error)) {
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
			// if (optimized) {
			// 	error = xmr->wallet->createUnsignedTransaction(data, tx, false);

			// }
		} else {
			ret->Set(String::NewFromUtf8(isolate, "unsigned"), String::NewFromUtf8(isolate, data.c_str()));
		}

		// if (isError(error)) {
		// 	std::string outputs;
 	// 		std::string secondError = xmr->wallet->exportOutputs(outputs);
 	// 		if (isError(secondError)) {
 	// 			error = std::string("Double error: ") + error + ", " + secondError;
		// 		ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
 	// 		} else {
		// 		ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		// 		ret->Set(String::NewFromUtf8(isolate, "outputs"), String::NewFromUtf8(isolate, outputs.c_str()));
 	// 		}
		// } else {
		// 	ret->Set(String::NewFromUtf8(isolate, "unsigned"), String::NewFromUtf8(isolate, data.c_str()));
		// }

		args.GetReturnValue().Set(ret);
	}

	void XMR::signTransaction(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 1 || !args[0]->IsString()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required argument: string blob")));
			return;
		}

		Local<Object> ret = Object::New(isolate);
	
		std::string error;
		std::string data(*v8::String::Utf8Value(args[0]->ToString()));

		int typ = xmr->wallet->dataType(data);
		if (typ <= 0) {
			error = std::string("Invalid data type ") + std::to_string(typ);
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		} else if (typ == XMR_DATA_TX_UNSIGNED || typ == XMR_DATA_TX_UNSIGNED_OPTIMIZED) {
			error = xmr->wallet->signTransaction(data);
			if (isError(error)) {
				ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
			} else {
				ret->Set(String::NewFromUtf8(isolate, "signed"), String::NewFromUtf8(isolate, data.c_str()));
			}
		} else if (typ == XMR_DATA_OUTPUTS) {
			error = xmr->wallet->importOutputs(data);
			if (isError(error)) {
				ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
			} else {
				error = xmr->wallet->exportKeyImages(data);
				if (isError(error)) {
					ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
				} else {
					ret->Set(String::NewFromUtf8(isolate, "keyImages"), String::NewFromUtf8(isolate, data.c_str()));
				}
			}
		} else {
			error = std::string("Invalid data type ") + std::to_string(typ);
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		}

		args.GetReturnValue().Set(ret);
	}

	void XMR::submitSignedTransaction(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		if (args.Length() != 1 || !args[0]->IsString()) {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Required argument: string blob")));
			return;
		}

		Local<Object> ret = Object::New(isolate);
	
		std::string error;
		std::string data(*v8::String::Utf8Value(args[0]->ToString()));

		int typ = xmr->wallet->dataType(data);
		if (typ <= 0) {
			error = std::string("Invalid data type ") + std::to_string(typ);
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		} else if (typ == XMR_DATA_TX_SIGNED || typ == XMR_DATA_TX_SIGNED_OPTIMIZED) {
			XMRTxInfo info;
			error = xmr->wallet->submitSignedTransaction(data, info);
			if (isError(error)) {
				ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
				
				// if (error != "No connection to daemon" && error != "Daemon is busy") {
				// 	std::string secondError = xmr->wallet->exportOutputs(data);
				// 	if (isError(secondError)) {
				// 		error = "Double error: " + error + ", " + secondError;
				// 		ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
				// 	} else {
				// 		ret->Set(String::NewFromUtf8(isolate, "outputs"), String::NewFromUtf8(isolate, data.c_str()));
				// 	}
				// }
			} else {
				ret->Set(String::NewFromUtf8(isolate, "info"), txInfoToObj(isolate, info));
			}
		} else if (typ == XMR_DATA_KEY_IMAGES) {
			uint64_t spent, unspent;
			error = xmr->wallet->importKeyImages(data, spent, unspent);
			if (isError(error)) {
				ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
			} else {
				error = std::string("Imported ") + std::to_string(spent) + " spent, " + std::to_string(unspent) + " unspent";
				ret->Set(String::NewFromUtf8(isolate, "status"), String::NewFromUtf8(isolate, error.c_str()));
			}
		} else {
			error = std::string("Invalid data type ") + std::to_string(typ);
			ret->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, error.c_str()));
		}

		args.GetReturnValue().Set(ret);
	}

	void XMR::transactions(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		XMR* xmr = ObjectWrap::Unwrap<XMR>(args.Holder());

		std::string paymentId;
		bool in = false;
		bool out = false;
		
		if (args.Length() > 0 && args[0]->IsString() && args[0]->ToString()->Length() > 0) {
			paymentId = std::string(*v8::String::Utf8Value(args[0]->ToString()));
			in = out = true;
		}

		if (args.Length() > 1 && args[1]->IsBoolean()) {
			in = args[1]->BooleanValue();
		}

		if (args.Length() > 2 && args[2]->IsBoolean()) {
			out = args[2]->BooleanValue();
		}

		std::vector<XMRTxInfo> txs;
		std::string error = xmr->wallet->transactions(paymentId, in, out, txs);

		if (error.empty()) {
			Local<Array> array = Array::New(isolate, txs.size());
			int i = 0; 

			for (XMRTxInfo tx: txs) {
				Local<Object> txObj = txInfoToObj(isolate, tx);
				array->Set(i++, txObj);
			}

			args.GetReturnValue().Set(array);
		} else {
			isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, error.c_str())));
		}

	}

	Local<Object> XMR::txInfoToObj(Isolate* isolate, XMRTxInfo tx) {
		Local<Object> txObj = Object::New(isolate);

		if (!tx.id.empty()) {
			txObj->Set(String::NewFromUtf8(isolate, "id"), String::NewFromUtf8(isolate, tx.id.c_str()));
		}
		if (!tx.payment_id.empty() && tx.payment_id != "0000000000000000") {
			txObj->Set(String::NewFromUtf8(isolate, "paymentId"), String::NewFromUtf8(isolate, tx.payment_id.c_str()));
		}
		if (!tx.key.empty()) {
			txObj->Set(String::NewFromUtf8(isolate, "key"), String::NewFromUtf8(isolate, tx.key.c_str()));
		}

		if (tx.amount != 0) {
			txObj->Set(String::NewFromUtf8(isolate, "amount"), String::NewFromUtf8(isolate, int64ToStr(tx.amount).c_str()));
		}
		if (tx.fee != 0) {
			txObj->Set(String::NewFromUtf8(isolate, "fee"), String::NewFromUtf8(isolate, int64ToStr(tx.fee).c_str()));
		}
		if (tx.timestamp != 0) {
			txObj->Set(String::NewFromUtf8(isolate, "timestamp"), String::NewFromUtf8(isolate, int64ToStr(tx.timestamp).c_str()));
		}
		if (tx.lock != 0) {
			txObj->Set(String::NewFromUtf8(isolate, "lock"), String::NewFromUtf8(isolate, int64ToStr(tx.lock).c_str()));
		}

		txObj->Set(String::NewFromUtf8(isolate, "height"), String::NewFromUtf8(isolate, int64ToStr(tx.height).c_str()));
		txObj->Set(String::NewFromUtf8(isolate, "in"), Boolean::New(isolate, tx.in));

		if (!tx.state.empty()) {
			txObj->Set(String::NewFromUtf8(isolate, "state"), String::NewFromUtf8(isolate, tx.state.c_str()));
		}

		if (!tx.error.empty()) {
			txObj->Set(String::NewFromUtf8(isolate, "error"), String::NewFromUtf8(isolate, tx.error.c_str()));
		}
		
		if (tx.destinations.size() > 0) {
			Local<Array> dests = Array::New(isolate, tx.destinations.size());
			int j = 0; 

			for (XMRDest dest : tx.destinations) {
				Local<Object> destObj = Object::New(isolate);

				if (!dest.address.empty()) {
					destObj->Set(String::NewFromUtf8(isolate, "address"), String::NewFromUtf8(isolate, dest.address.c_str()));
				}
				if (dest.amount != 0) {
					destObj->Set(String::NewFromUtf8(isolate, "amount"), String::NewFromUtf8(isolate, int64ToStr(dest.amount).c_str()));
				}
				dests->Set(j++, destObj);
			}
		
			txObj->Set(String::NewFromUtf8(isolate, "destinations"), dests);
		}

		return txObj;
	}


	void XMR::testIt(const FunctionCallbackInfo<Value>& args) {
		Isolate* isolate = args.GetIsolate();
		Local<Context> context = isolate->GetCurrentContext();

		XMR* view = ObjectWrap::Unwrap<XMR>(args[0]->ToObject(context).ToLocalChecked());
		XMR* spend = ObjectWrap::Unwrap<XMR>(args[1]->ToObject(context).ToLocalChecked());
		XMR* recipient = ObjectWrap::Unwrap<XMR>(args[2]->ToObject(context).ToLocalChecked());

		XMRTx tx;
		tx.priority = 1;
		tx.mixins = 4;
		tx.unlock_time = 0;

		XMRDest dest;
		dest.amount = 3e12;
		dest.address = recipient->wallet->address();

		tx.destinations.push_back(dest);

		// std::string unsign = view->wallet->createUnsignedTransaction(tx);
		// logstream << "unsinged: " << unsign << EOL;
		
		// std::string sign = spend->wallet->signTransaction(unsign);
		// logstream << "singed: " << sign << EOL;
		
		// std::string submitted = view->wallet->submitSignedTransaction(sign);
		// logstream << "submitted: " << submitted << EOL;
	}

	uint64_t XMR::strToInt64(std::string str) {
		uint64_t n = boost::lexical_cast<uint64_t>(str);
		return n;
		// // or
		// std::istringstream ss("48543954385");
		// if (!(ss >> test))
		// std::cout << "failed" << std::endl;
	}

	std::string XMR::int64ToStr(uint64_t n) {
		std::ostringstream oss;
		oss << n;
		std::string intAsString(oss.str());
		return intAsString;
	}

	std::string XMR::encodeBase64(std::string &data) {
		return epee::string_encoding::base64_encode(data);
	}

	std::string XMR::decodeBase64(std::string &data) {
		return epee::string_encoding::base64_decode(data);
	}

	bool XMR::isError(std::string &str) {
		return str.size() > 0;
		// return str.size() > 0 && memcmp(str.data(), "-", 1) == 0;
	}

	//----------------- i_wallet2_callback ---------------------
	void XMR::on_new_block(uint64_t height, const cryptonote::block& block) {
		Isolate * isolate = Isolate::GetCurrent();
		auto local = Local<Function>::New(isolate, onBlock);

		const unsigned argc = 1;
		Local<Value> argv[argc] = { String::NewFromUtf8(isolate, int64ToStr(height).c_str()) };

		local->Call(isolate->GetCurrentContext()->Global(), argc, argv);
	}

	void XMR::on_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount) {
		// std::cout << "on_money_received " << txid << " " << amount << "\n";
		on_tx(true, txid);
	}

	void XMR::on_unconfirmed_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount) {
		// std::cout << "on_unconfirmed_money_received " << txid << " " << amount << "\n";
		on_tx(true, txid);
	}

	void XMR::on_money_spent(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& in_tx, uint64_t amount, const cryptonote::transaction& spend_tx) {
		// std::cout << "on_money_spent " << txid << " " << amount << "\n";
		on_tx(false, txid);
	}

	void XMR::on_skip_transaction(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx) {
		// std::cout << "on_skip_transaction " << txid << "\n";
		on_tx(false, txid);
	}

	void XMR::on_tx(bool in, const crypto::hash &txid) {
		Isolate * isolate = Isolate::GetCurrent();
		auto local = Local<Function>::New(isolate, onTx);

		// std::vector<XMRTxInfo> txs;
		// std::string error = wallet->transactions(epee::string_tools::pod_to_hex(txid), in, !in, txs);
		// if (txs.size() == 0) {
		// 	std::cout << "============== +++++++++++++++ ----------------- " <<  epee::string_tools::pod_to_hex(txid) << "\n";
		// }

		const unsigned argc = 2;
		Local<Value> argv[argc] = { Boolean::New(isolate, in), String::NewFromUtf8(isolate, epee::string_tools::pod_to_hex(txid).c_str()) };

		local->Call(isolate->GetCurrentContext()->Global(), argc, argv);
	}

}