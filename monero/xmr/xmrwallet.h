#pragma once

#include "wallet/wallet2.h"
#include <boost/iostreams/filter/gzip.hpp>
#include <boost/iostreams/filtering_stream.hpp>
#include <boost/iostreams/copy.hpp>
#include <boost/serialization/map.hpp>
#include <boost/serialization/list.hpp>
#include <boost/serialization/vector.hpp>
#include <boost/archive/binary_oarchive.hpp>
#include <boost/archive/binary_iarchive.hpp>
#include "string_coding.h"

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
	std::string payment_id;
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
	uint64_t height;
	bool in;
	uint64_t lock;
	std::string state;
	std::string error;

	std::vector<XMRDest> destinations;
};

#define XMR_PREFIX 						"XMR"
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

	struct xmr_kis {
		std::vector<size_t> idxs;
		std::vector<crypto::key_image> key_images;

		BEGIN_SERIALIZE_OBJECT()
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
			uint64_t nodeHeight();
			XMRAddress addressDecode(std::string &address_string);
			std::string addressEncode(std::string &address_string, std::string &payment_id_string);
			bool refresh_and_store();
			bool close();
			std::string refresh(bool &refreshed);
			
			std::string transactions(std::string payment_id_str, bool in, bool out, std::vector<XMRTxInfo> &txs);

			void infoFromUnconfirmedTransaction(XMRTxInfo &info, crypto::hash hash, tools::wallet2::unconfirmed_transfer_details pd);

			bool startAutoRefresh();
			bool stopAutoRefresh();
			void wallet_idle_thread();

			uint32_t dataType(std::string &data);
			std::string exportOutputs(std::string &outputs);
			std::string importOutputs(std::string &data);
			std::string exportKeyImages(std::string &images);
			std::string importKeyImages(std::string &data, uint64_t &spent, uint64_t &unspent);

			void print_pid(std::string msg, std::vector<uint8_t> &extra);
			crypto::hash8 get_short_pid(const pending_tx &ptx);
	};

	template <typename T> inline std::string saveGZBase64String(uint32_t type, const T & o) {
		// std::stringstream compressed;
		// std::ostringstream origin;

		// boost::iostreams::filtering_streambuf<boost::iostreams::input> out;
		// out.push(boost::iostreams::gzip_compressor(boost::iostreams::gzip_params(boost::iostreams::gzip::best_compression)));
		// out.push(origin);

		// boost::archive::portable_binary_oarchive oa(origin);
		// oa << o;

		// boost::iostreams::copy(out, compressed);
		// return std::to_string(type) + epee::string_encoding::base64_encode(origin.str());
		
		std::stringstream data;
		data << type;
		boost::archive::portable_binary_oarchive arch(data);
		arch << o;

		std::stringstream compressed;
		boost::iostreams::filtering_streambuf<boost::iostreams::input> out;
		out.push(boost::iostreams::gzip_compressor(boost::iostreams::gzip_params(boost::iostreams::gzip::best_compression)));
		out.push(data);
		boost::iostreams::copy(out, compressed);

		return epee::string_encoding::base64_encode(compressed.str());
		// return std::to_string(type) + "|" + epee::string_encoding::base64_encode(data.str());
	}

	template <typename T> inline void loadGZBase64String(uint32_t &type, T & o, const std::string& s) {
		// size_t pos = s.find("|");
		// type = std::stoi(s.substr(0, pos));
		std::string data = epee::string_encoding::base64_decode(s);

		std::stringstream compressed(data);
		std::stringstream decompressed;

		boost::iostreams::filtering_streambuf<boost::iostreams::input> out;
		out.push(boost::iostreams::gzip_decompressor());
		out.push(compressed);
		boost::iostreams::copy(out, decompressed);

		decompressed >> type;
		boost::archive::portable_binary_iarchive ar(decompressed);
		ar >> o;

		// type = std::stoi(s.substr(0, 1));
		// std::string data = s.substr(1);

		// std::istringstream compressed(epee::string_encoding::base64_decode(data));
		// std::istringstream decompressed;

		// boost::iostreams::filtering_streambuf<boost::iostreams::input> in;
		// in.push(boost::iostreams::zlib_decompressor());
		// in.push(compressed);
		// boost::iostreams::copy(in, decompressed);

		// boost::archive::portable_binary_iarchive ia(decompressed);
		// ia >> o;

		// return decompressed;


		// iss >> type;
		// bio::filtering_stream<bio::input> f;
		// // f.push(bio::gzip_decompressor());
		// f.push(iss);
		// bar::binary_iarchive ia(f);
		// ia >> o;
	}

	inline void loadGZBase64StringType(uint32_t &type, const std::string& s) {
		std::string data = epee::string_encoding::base64_decode(s);
		std::stringstream compressed(data);
		std::stringstream decompressed;

		boost::iostreams::filtering_streambuf<boost::iostreams::input> out;
		out.push(boost::iostreams::gzip_decompressor());
		out.push(compressed);
		boost::iostreams::copy(out, decompressed);

		decompressed >> type;
	}
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
    inline typename std::enable_if<!Archive::is_loading::value, void>::type initialize_xmr_from_spend(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline typename std::enable_if<Archive::is_loading::value, void>::type initialize_xmr_from_spend(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline void serialize(Archive &a, tools::xmr_from_spend &x, const boost::serialization::version_type ver)
    {
      a & x.txs;
      a & x.idxs;
      a & x.key_images;
    }

    template <class Archive>
    inline typename std::enable_if<!Archive::is_loading::value, void>::type initialize_xmr_kis(Archive &a, tools::xmr_kis &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline typename std::enable_if<Archive::is_loading::value, void>::type initialize_xmr_kis(Archive &a, tools::xmr_kis &x, const boost::serialization::version_type ver)
    {
    }

    template <class Archive>
    inline void serialize(Archive &a, tools::xmr_kis &x, const boost::serialization::version_type ver)
    {
      a & x.idxs;
      a & x.key_images;
    }
  }
}

