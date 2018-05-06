#include <node.h>
#include <node_object_wrap.h>
#include <string>

#include "xmrwallet.h"

namespace tools {
	using v8::FunctionCallbackInfo;
	using v8::Function;
	using v8::Persistent;
	using v8::Local;
	using v8::Object;
	using v8::Isolate;
	using v8::Value;

	class XMR : public node::ObjectWrap, public tools::i_wallet2_callback {
	public:
		static void Init(v8::Local<v8::Object> exports);
		static void addressDecode(const FunctionCallbackInfo<Value>& args);
		static void addressEncode(const FunctionCallbackInfo<Value>& args);
		static void createPaperWallet(const FunctionCallbackInfo<Value>& args);

	private:
		explicit XMR(bool testnet, std::string daemon, bool ssl);
		~XMR();

		static void createIntegratedAddress(const FunctionCallbackInfo<Value>& args);
		static void openPaperWallet(const FunctionCallbackInfo<Value>& args);
		static void openViewWallet(const FunctionCallbackInfo<Value>& args);
		static void openViewWalletOffline(const FunctionCallbackInfo<Value>& args);
		static void setCallbacks(const FunctionCallbackInfo<Value>& args);
		static void address(const FunctionCallbackInfo<Value>& args);
		static void testnet(const FunctionCallbackInfo<Value>& args);
		static void connect(const FunctionCallbackInfo<Value>& args);
		static void refresh(const FunctionCallbackInfo<Value>& args);
		static void refresh_and_store(const FunctionCallbackInfo<Value>& args);
		static void close(const FunctionCallbackInfo<Value>& args);
		static void store(const FunctionCallbackInfo<Value>& args);
		static void rescan(const FunctionCallbackInfo<Value>& args);
		static void balances(const FunctionCallbackInfo<Value>& args);
		static void height(const FunctionCallbackInfo<Value>& args);
		static void connected(const FunctionCallbackInfo<Value>& args);
		static void disconnect(const FunctionCallbackInfo<Value>& args);
		static void cleanup(const FunctionCallbackInfo<Value>& args);

		static void dataType(const FunctionCallbackInfo<Value>& args);
		static void createUnsignedTransaction(const FunctionCallbackInfo<Value>& args);
		static void signTransaction(const FunctionCallbackInfo<Value>& args);
		static void submitSignedTransaction(const FunctionCallbackInfo<Value>& args);
		static void exportOutputs(const FunctionCallbackInfo<Value>& args);
		static void importOutputs(const FunctionCallbackInfo<Value>& args);
		static void exportKeyImages(const FunctionCallbackInfo<Value>& args);
		static void importKeyImages(const FunctionCallbackInfo<Value>& args);

		static void transactions(const FunctionCallbackInfo<Value>& args);

		static void New(const v8::FunctionCallbackInfo<v8::Value>& args);
		static v8::Persistent<v8::Function> constructor;
		
		static void testIt(const FunctionCallbackInfo<Value>& args);

		static Local<Object> txInfoToObj(Isolate* isolate, XMRTxInfo tx);

		static uint64_t strToInt64(std::string str);
		static std::string int64ToStr(uint64_t n);
		static std::string encodeBase64(std::string &data);
		static std::string decodeBase64(std::string &data);
		static bool isError(std::string &str);

		std::string daemon;
		bool ssl;

		XMRWallet *wallet;

		Persistent<Function> onTx, onBlock;
		void on_tx(bool in, const crypto::hash &txid);

		//----------------- i_wallet2_callback ---------------------
		virtual void on_new_block(uint64_t height, const cryptonote::block& block);
		virtual void on_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount);
		virtual void on_unconfirmed_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount);
		virtual void on_money_spent(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& in_tx, uint64_t amount, const cryptonote::transaction& spend_tx);
		virtual void on_skip_transaction(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx);
	};
}
