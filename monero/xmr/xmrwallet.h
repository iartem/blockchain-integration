#pragma once

#include "wallet/wallet2.h"
#include <boost/serialization/map.hpp>
#include <boost/serialization/list.hpp>
#include <boost/serialization/vector.hpp>

struct XMRKeys {
	std::string spend;
	std::string view;
	std::string address;
	std::string mnemonics;
};

struct XMRAddress {
	std::string address;
	std::string payment_id;
};

struct XMRDest {
	std::string address;
	uint64_t amount;
};

struct XMRTx {
	std::vector<XMRDest> destinations;
	uint32_t priority;
	uint32_t unlock_time;
	uint32_t mixins;
};

struct XMRTxInfo {
	std::string id;
	std::string payment_id;
	std::string key;

	uint64_t amount;
	uint64_t fee;
	uint64_t timestamp;
	bool in;
	std::string state;
	std::string error;

	std::vector<XMRDest> destinations;
};

#define XMR_DATA_TX_UNSIGNED 			1
#define XMR_DATA_TX_UNSIGNED_OPTIMIZED 	2
#define XMR_DATA_TX_SIGNED 				3
#define XMR_DATA_TX_SIGNED_OPTIMIZED    4
#define XMR_DATA_OUTPUTS 				5
#define XMR_DATA_KEY_IMAGES				6

namespace tools {
	struct xmr_from_view {
		std::vector<wallet2::tx_construction_data> txs;
		std::vector<size_t> idxs;
		std::vector<wallet2::transfer_details> transfers;

		BEGIN_SERIALIZE_OBJECT()
		FIELD(txs)
		FIELD(idxs)
		FIELD(transfers)
		END_SERIALIZE()
	};

	struct xmr_from_spend {
		std::vector<wallet2::pending_tx> txs;
		std::vector<size_t> idxs;
		std::vector<crypto::key_image> key_images;

		BEGIN_SERIALIZE_OBJECT()
		FIELD(txs)
		FIELD(idxs)
		FIELD(key_images)
		END_SERIALIZE()
	};


	class XMRWallet : public wallet2 {
		public:
			XMRWallet(bool testnet = false);

    		bool check_connection(uint32_t *version = NULL, uint32_t timeout = 200000);
			bool disconnect();
			void stop();
			bool cleanup();

			XMRKeys createPaperWallet(const std::string &language);
			bool openPaperWallet(const std::string &spendKey);
			int openViewWallet(const std::string &address_string, const std::string &view_key_string);
			int openViewWalletOffline(const std::string &address_string, const std::string &view_key_string);
			std::string createIntegratedAddress(const std::string &payment_id);
			std::string createUnsignedTransaction(std::string &data, XMRTx& tx, bool optimized);
			std::string signTransaction(std::string &data);
			std::string submitSignedTransaction(std::string &data, XMRTxInfo &info);
			std::string address();
			void balances(uint64_t &balance, uint64_t &unlocked);
			XMRAddress addressDecode(std::string &address_string);
			bool refresh_and_store();
			std::string refresh(bool &refreshed);
			
			std::string transactions(std::string payment_id_str, bool in, bool out, std::vector<XMRTxInfo> &txs);

			void infoFromUnconfirmedTransaction(XMRTxInfo &info, crypto::hash hash, tools::wallet2::unconfirmed_transfer_details pd);

			bool startAutoRefresh();
			bool stopAutoRefresh();
			void wallet_idle_thread();

			int dataType(std::string &data);
			std::string exportOutputs(std::string &outputs);
			std::string importOutputs(std::string &data);
			std::string exportKeyImages(std::string &images);
			std::string importKeyImages(std::string &data, uint64_t &spent, uint64_t &unspent);

		private:
			std::atomic<bool> m_idle_run;
			boost::thread m_idle_thread;
			boost::mutex m_idle_mutex;
			boost::condition_variable m_idle_cond;

			std::atomic<bool> m_auto_refresh_enabled;
			bool m_auto_refresh_refreshing;
			// bool sign_tx(unsigned_tx_set &exported_txs, const std::string &signed_filename, std::vector<wallet2::pending_tx> &txs, bool export_raw);

	};
}

namespace boost
{
  namespace serialization
  {
    template <class Archive>
    inline typename std::enable_if<!Archive::is_loading::value, void>::type initialize_xmr_from_view(Archive &a, tools::xmr_from_view &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline typename std::enable_if<Archive::is_loading::value, void>::type initialize_xmr_from_view(Archive &a, tools::xmr_from_view &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline void serialize(Archive &a, tools::xmr_from_view &x, const boost::serialization::version_type ver)
    {
      a & x.txs;
      a & x.idxs;
      a & x.transfers;
    }


    template <class Archive>
    inline typename std::enable_if<!Archive::is_loading::value, void>::type initialize_xmr_from_view(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline typename std::enable_if<Archive::is_loading::value, void>::type initialize_xmr_from_view(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline void serialize(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
      a & x.txs;
      a & x.idxs;
      a & x.key_images;
    }
  }
}

