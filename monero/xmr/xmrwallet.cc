#include "xmrwallet.h"
// #include "wallet/api/wallet.h"
// #include "wallet/wallet_errors.h"
#include "mnemonics/electrum-words.h"
#include "cryptonote_basic/cryptonote_basic.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_basic/account.h"
#include "cryptonote_core/cryptonote_tx_utils.h"
#include "string_tools.h"
#include "misc_log_ex.h"
#include <boost/format.hpp>

#define LOCK_IDLE_SCOPE() \
  bool auto_refresh_enabled = m_auto_refresh_enabled.load(std::memory_order_relaxed); \
  m_auto_refresh_enabled.store(false, std::memory_order_relaxed); \
  /* stop any background refresh, and take over */ \
  stop(); \
  m_idle_mutex.lock(); \
  while (m_auto_refresh_refreshing) \
	m_idle_cond.notify_one(); \
  m_idle_mutex.unlock(); \
/*  if (auto_refresh_run)*/ \
	/*m_auto_refresh_thread.join();*/ \
  boost::unique_lock<boost::mutex> lock(m_idle_mutex); \
  epee::misc_utils::auto_scope_leave_caller scope_exit_handler = epee::misc_utils::create_scope_leave_handler([&](){ \
	m_auto_refresh_enabled.store(auto_refresh_enabled, std::memory_order_relaxed); \
  })

using namespace cryptonote;

namespace tools {

	XMRWallet::XMRWallet(bool testnet) : wallet2(testnet) {
		std::string log_path = "wallet.log";
		mlog_configure(log_path, false);
		mlog_set_log_level(0);
	}

	XMRKeys XMRWallet::createPaperWallet(const std::string &language) {
		cryptonote::account_base *acc = new cryptonote::account_base();

		std::string electrum;
		crypto::secret_key dummy_key;
		crypto::secret_key spend = acc->generate(dummy_key, false, false);

		crypto::ElectrumWords::bytes_to_words(spend, electrum, language);

		XMRKeys keys;
		keys.spend = epee::string_tools::pod_to_hex(spend);
		keys.view = epee::string_tools::pod_to_hex(acc->get_keys().m_view_secret_key);
		keys.address = acc->get_public_address_str(testnet());
		keys.mnemonics = electrum;

		return keys;
	}

	bool XMRWallet::openPaperWallet(const std::string &spendkey_str) {
		clear();

		crypto::secret_key spendkey;
		cryptonote::blobdata spendkey_data;
		if(!epee::string_tools::parse_hexstr_to_binbuff(spendkey_str, spendkey_data) || spendkey_data.size() != sizeof(crypto::secret_key)) {
			return false;
		}
		spendkey = *reinterpret_cast<const crypto::secret_key*>(spendkey_data.data());

		crypto::secret_key retval = m_account.generate(spendkey, true, false);
		m_account_public_address = m_account.get_keys().m_account_address;
		m_watch_only = false;

		cryptonote::block b;
		generate_genesis(b);
		m_blockchain.push_back(get_block_hash(b));

		return true;
	}

	int XMRWallet::openViewWallet(const std::string &address_string, const std::string &view_key_string) {
		clear();
		m_keys_file = address_string + ".keys";
		m_wallet_file = address_string;

		boost::system::error_code ignored_ec;
		if (boost::filesystem::exists(m_wallet_file, ignored_ec) || boost::filesystem::exists(m_keys_file, ignored_ec)) {
			try {
				if (load_keys(m_keys_file, "")) {
					load(m_wallet_file, "");
					return 0;
				}
			} catch (...) {
				boost::filesystem::remove(m_wallet_file);
				boost::filesystem::remove(m_keys_file);
			}
		}

		bool has_payment_id;
		cryptonote::account_public_address address;
		crypto::hash8 new_payment_id;
		if (!cryptonote::get_account_integrated_address_from_str(address, has_payment_id, new_payment_id, testnet(), address_string)) {
			return -1;
		}

		cryptonote::blobdata viewkey_data;
		if (!epee::string_tools::parse_hexstr_to_binbuff(view_key_string, viewkey_data) || viewkey_data.size() != sizeof(crypto::secret_key)) {
			return -2;
		}
		crypto::secret_key viewkey = *reinterpret_cast<const crypto::secret_key*>(viewkey_data.data());

		m_account.create_from_viewkey(address, viewkey);
		m_account_public_address = address;
		m_watch_only = true;

		if (!store_keys(m_keys_file, "", true)) {
			return -3;
		}
		cryptonote::block b;
		generate_genesis(b);
		m_blockchain.push_back(get_block_hash(b));

		set_refresh_from_block_height(0);

		store();

		return 0;
	}

	int XMRWallet::openViewWalletOffline(const std::string &address_string, const std::string &view_key_string) {
		clear();

		bool has_payment_id;
		cryptonote::account_public_address address;
		crypto::hash8 new_payment_id;
		if (!cryptonote::get_account_integrated_address_from_str(address, has_payment_id, new_payment_id, testnet(), address_string)) {
			return -1;
		}

		cryptonote::blobdata viewkey_data;
		if (!epee::string_tools::parse_hexstr_to_binbuff(view_key_string, viewkey_data) || viewkey_data.size() != sizeof(crypto::secret_key)) {
			return -2;
		}
		crypto::secret_key viewkey = *reinterpret_cast<const crypto::secret_key*>(viewkey_data.data());

		m_account.create_from_viewkey(address, viewkey);
		m_account_public_address = address;
		m_watch_only = true;

		return 0;
	}

	std::string XMRWallet::createIntegratedAddress(const std::string &payment_id) {
		crypto::hash8 id;

		if (!payment_id.empty()) {
			if (!parse_short_payment_id(payment_id, id)) {
				return "";
			}
		} else {
			id = crypto::rand<crypto::hash8>();
		}

		return m_account.get_public_integrated_address_str(id, testnet());
	}


	bool XMRWallet::check_connection(uint32_t *version, uint32_t timeout) {
		if (!this->m_is_initialized) {
			return false;
		} else {
			return wallet2::check_connection(version, timeout);
		}
	}

	bool XMRWallet::disconnect() {
		LOCK_IDLE_SCOPE();
		this->m_http_client.disconnect();
		return this->deinit();
	}

	bool XMRWallet::cleanup() {
		clear();
		if (!m_wallet_file.empty()) {
			boost::filesystem::remove(m_wallet_file);
		}
		if (!m_keys_file.empty()) {
			boost::filesystem::remove(m_keys_file);
		}
		return true;
	}

	void XMRWallet::balances(uint64_t &balance, uint64_t &unlocked) {
		balance = this->balance();
		unlocked = this->unlocked_balance();
	}

	uint32_t XMRWallet::dataType(std::string &data) {
		if (data.size() < 100) {
			return -1;
		}

		try {
			uint32_t type;
			loadGZBase64StringType(type, data);
			return type;
		} catch (...) {
			return -1;
		}
	}

	std::string XMRWallet::createUnsignedTransaction(std::string &data, XMRTx& tx, bool optimized) {
		try {
			LOG_PRINT_L1("===== rescanning spent");
			rescan_spent();
			LOG_PRINT_L1("===== rescanning spent done");
		} catch (...) {
			LOG_PRINT_L1("===== rescanning spent ERROR");
		}

		std::vector<cryptonote::tx_destination_entry> dsts;
		std::vector<uint8_t> extra;

		for (auto& dst: tx.destinations) {
			
			bool has_payment_id;
			cryptonote::account_public_address address;
			crypto::hash8 payment_id;
			if (!cryptonote::get_account_integrated_address_from_str(address, has_payment_id, payment_id, testnet(), dst.address)) {
				return "Wrong address: " + dst.address;
			}

			if (has_payment_id) {
				if (extra.size() > 0) {
					return "Multiple payment ids in a transaction";
				}
				std::string extra_nonce;
				set_encrypted_payment_id_to_tx_extra_nonce(extra_nonce, payment_id);
				if (!add_extra_nonce_to_tx_extra(extra, extra_nonce)) {
					return "Failed to add short payment id to transaction: " + epee::string_tools::pod_to_hex(payment_id);
				}
			}

			cryptonote::tx_destination_entry de;
			de.addr = address;
			de.amount = dst.amount;
			// de.is_subaddress = info.is_subaddress;
			dsts.push_back(de);
		}

		std::vector<wallet2::pending_tx> ptx;
		try {
			ptx = create_transactions_2(dsts, tx.mixins, tx.unlock_time, tx.priority, extra, true);
		} catch (const tools::error::not_enough_money&) {
			return "Not enough money";
		} catch (const tools::error::zero_destination&) {
			return "Amount zero would reach destination";
		} catch (const tools::error::wallet_internal_error &e) {
			return e.what();
			// return "-Internal wallet error";
		} catch (const tools::error::tx_not_possible &e) {
			return e.what();
		} catch(const std::runtime_error &e) {
			return std::string("Runtime error when creating transaction: ") + e.what();
		} catch(const std::exception &e) {
			return std::string("Exception when creating transaction: ") + e.what();
		} catch (...) {
			return "Internal XMR error";
		}

		for (auto &tx: ptx) {
			tx_construction_data construction_data = tx.construction_data;
			// Short payment id is encrypted with tx_key. 
			// Since sign_tx() generates new tx_keys and encrypts the payment id, we need to save the decrypted payment ID
			// Get decrypted payment id from pending_tx
			crypto::hash8 payment_id = get_short_payment_id(tx);
			if (payment_id != null_hash8) {
				// Remove encrypted
				remove_field_from_tx_extra(construction_data.extra, typeid(cryptonote::tx_extra_nonce));
				// Add decrypted
				std::string extra_nonce;
				set_encrypted_payment_id_to_tx_extra_nonce(extra_nonce, payment_id);
				if (!add_extra_nonce_to_tx_extra(construction_data.extra, extra_nonce)) {
					LOG_ERROR("Failed to add decrypted payment id to tx extra");
					return false;
				}
				LOG_PRINT_L1("Decrypted payment ID: " << payment_id);       
			}
		}

		if (optimized) {
			tools::xmr_from_view arch;

			std::set<size_t> indexes;

			for (auto &tx: ptx) {
				// Save tx construction_data to unsigned_tx_set
				arch.txs.push_back(tx.construction_data);     
				
				// save all selected indexes
				for (size_t idx : tx.selected_transfers) {
					indexes.insert(idx);
				}
			}

			// also select all indexes which don't have key image for
			for (size_t i = 0; i < m_transfers.size(); ++i) {
				const transfer_details& td = m_transfers[i];

				if (!td.m_key_image_known) {
					indexes.insert(i);
				}
			}

			LOG_ERROR(std::string("=======>>>>>>> going to export ") + std::to_string(indexes.size()) + " outputs out ot " + std::to_string(m_transfers.size()));

			// collect transfers we need
			for (size_t idx : indexes) {
				const transfer_details& td = m_transfers[idx];
				arch.idxs.push_back(idx);
				arch.transfers.push_back(td);
			}

			// serialize
			try {
				data = saveGZBase64String(XMR_DATA_TX_UNSIGNED_OPTIMIZED, arch);
			} catch(...) {
				return "Cannot serialize optimized unsigned tx";
			}

		} else {
			unsigned_tx_set txs;

			try {
				data = saveGZBase64String(XMR_DATA_TX_UNSIGNED, txs);
			} catch(...) {
				return "Cannot serialize unsigned tx";
			}
		}

		return "";
	}
	
	std::string XMRWallet::signTransaction(std::string &data) {
		unsigned_tx_set exported_txs;
		std::vector<size_t> keyIdxs;
		std::vector<crypto::key_image> keyImages;

		uint32_t type = dataType(data);

		// parsing
		if (type == XMR_DATA_TX_UNSIGNED_OPTIMIZED) {

			xmr_from_view arch;

			try {
				loadGZBase64String(type, arch, data);
			} catch (...) {
				return "Failed to parse optimized unsigned tx data";
			}

			// import outputs
			if (arch.transfers.size() > 0) {
				size_t max_idx = arch.idxs.back();

				// placeholder transfer
				transfer_details tmp;

				// fill m_transfers up to biggest element
				m_transfers.clear();
				for (size_t i = 0; i <= max_idx; i++) {
					m_transfers.push_back(tmp);
				}

				for (size_t i = 0; i < arch.idxs.size(); i++) {
					size_t idx = arch.idxs[i];
					transfer_details &td = arch.transfers[i];

					// reset placeholder transfer with actual one
					m_transfers[idx] = td;

					// calculate key images for imported output
					try {
						cryptonote::keypair in_ephemeral;
						std::vector<tx_extra_field> tx_extra_fields;
						tx_extra_pub_key pub_key_field;

						THROW_WALLET_EXCEPTION_IF(td.m_tx.vout.empty(), error::wallet_internal_error, "tx with no outputs at index " + boost::lexical_cast<std::string>(i));
						THROW_WALLET_EXCEPTION_IF(!parse_tx_extra(td.m_tx.extra, tx_extra_fields), error::wallet_internal_error,
						"Transaction extra has unsupported format at index " + boost::lexical_cast<std::string>(i));
						crypto::public_key tx_pub_key = get_tx_pub_key_from_received_outs(td);

						cryptonote::generate_key_image_helper(m_account.get_keys(), tx_pub_key, td.m_internal_output_index, in_ephemeral, td.m_key_image);
						td.m_key_image_known = true;
						THROW_WALLET_EXCEPTION_IF(in_ephemeral.pub != boost::get<cryptonote::txout_to_key>(td.m_tx.vout[td.m_internal_output_index].target).key,
						error::wallet_internal_error, "key_image generated ephemeral public key not matched with output_key at index " + boost::lexical_cast<std::string>(i));

						m_key_images[td.m_key_image] = idx;
						m_pub_keys[td.get_public_key()] = idx;

						// save it to return later
						keyImages.push_back(td.m_key_image);

					} catch (error::wallet_internal_error &e) {
						return e.what();
					}
				}

				LOG_ERROR(std::string("=======<<<<<<< going to import ") + std::to_string(arch.idxs.size()) + " outputs & export " + std::to_string(keyImages.size()) + " key images");

				keyIdxs = arch.idxs;
			}

			// just to keep standard implementation of sign_tx in place
			exported_txs.txes = arch.txs;
			exported_txs.transfers = m_transfers; 

		} else if (type == XMR_DATA_TX_UNSIGNED) {

			try {
				loadGZBase64String(type, exported_txs, data);
			} catch (...) {
				return "Failed to parse unsigned tx data";
			}

		} else {
			return "Bad magic in unsigned tx data";
		}


		// sign (sign_tx)
		std::vector<pending_tx> ptxs;
		try {
			for (size_t n = 0; n < exported_txs.txes.size(); ++n) {
				const tools::wallet2::tx_construction_data &sd = exported_txs.txes[n];
				LOG_PRINT_L1(" " << (n+1) << ": " << sd.sources.size() << " inputs, ring size " << sd.sources[0].outputs.size());
				ptxs.push_back(pending_tx());
				tools::wallet2::pending_tx &ptx = ptxs.back();
				crypto::secret_key tx_key;
				bool r = cryptonote::construct_tx_and_get_tx_key(m_account.get_keys(), sd.sources, sd.splitted_dsts, sd.extra, ptx.tx, sd.unlock_time, tx_key, sd.use_rct);
				THROW_WALLET_EXCEPTION_IF(!r, error::tx_not_constructed, sd.sources, sd.splitted_dsts, sd.unlock_time, m_testnet);
				// we don't test tx size, because we don't know the current limit, due to not having a blockchain,
				// and it's a bit pointless to fail there anyway, since it'd be a (good) guess only. We sign anyway,
				// and if we really go over limit, the daemon will reject when it gets submitted. Chances are it's
				// OK anyway since it was generated in the first place, and rerolling should be within a few bytes.

				// normally, the tx keys are saved in commit_tx, when the tx is actually sent to the daemon.
				// we can't do that here since the tx will be sent from the compromised wallet, which we don't want
				// to see that info, so we save it here
				if (store_tx_info()) {
					const crypto::hash txid = get_transaction_hash(ptx.tx);
					m_tx_keys.insert(std::make_pair(txid, tx_key));
				}

				std::string key_images;
				bool all_are_txin_to_key = std::all_of(ptx.tx.vin.begin(), ptx.tx.vin.end(), [&](const txin_v& s_e) -> bool {
					CHECKED_GET_SPECIFIC_VARIANT(s_e, const txin_to_key, in, false);
					key_images += boost::to_string(in.k_image) + " ";
					return true;
				});
				THROW_WALLET_EXCEPTION_IF(!all_are_txin_to_key, error::unexpected_txin_type, ptx.tx);

				ptx.key_images = key_images;
				ptx.fee = 0;
				for (const auto &i: sd.sources) ptx.fee += i.amount;
				for (const auto &i: sd.splitted_dsts) ptx.fee -= i.amount;
				ptx.dust = 0;
				ptx.dust_added_to_fee = false;
				ptx.change_dts = sd.change_dts;
				ptx.selected_transfers = sd.selected_transfers;
				ptx.tx_key = rct::rct2sk(rct::identity()); // don't send it back to the untrusted view wallet
				ptx.dests = sd.dests;
				ptx.construction_data = sd;
			}
		} catch (const error::tx_not_constructed&) {
			return "Failed to construct tx in cryptonote";
		} catch(const std::runtime_error &e) {
			return std::string("Runtime error when signing transaction: ") + e.what();
		} catch(const std::exception &e) {
			return std::string("Exception when signing transaction: ") + e.what();
		} catch (...) {
			return "Unhandled exception"; 
		}

		if (keyImages.size() > 0) {
			xmr_from_spend arch;

			arch.txs = ptxs;
			arch.idxs = keyIdxs;
			arch.key_images = keyImages;

			try {
				data = saveGZBase64String(XMR_DATA_TX_SIGNED_OPTIMIZED, arch);
				return "";
			} catch(...) {
				return "Failed to serialize optimized signed tx";
			}

		} else {
			signed_tx_set signed_txes;
			signed_txes.ptx = ptxs;
			
			signed_txes.key_images.resize(m_transfers.size());
			for (size_t i = 0; i < m_transfers.size(); ++i) {
				if (!m_transfers[i].m_key_image_known) {
					LOG_PRINT_L0("WARNING: key image not known in signing wallet at index " << i);
				}
				signed_txes.key_images[i] = m_transfers[i].m_key_image;
			}

			try {
				data = saveGZBase64String(XMR_DATA_TX_SIGNED, signed_txes);
				return "";
			} catch(...) {
				return "Failed to serialize signed tx";
			}
		}
	}
	
	std::string XMRWallet::submitSignedTransaction(std::string &data, XMRTxInfo &info) {
		std::vector<tools::wallet2::pending_tx> ptx;

		uint32_t type = dataType(data);

		if (type == XMR_DATA_TX_SIGNED_OPTIMIZED) {

			xmr_from_spend arch;

			try {
				loadGZBase64String(type, arch, data);
			} catch (...) {
				return "Failed to parse optimized signed tx data";
			}
			
			for (size_t i = 0; i < arch.idxs.size(); ++i) {
				size_t idx = arch.idxs[i];
				crypto::key_image key_image = arch.key_images[i];

				transfer_details &td = m_transfers[idx];
				if (td.m_key_image_known && td.m_key_image != key_image) {
					LOG_PRINT_L0("WARNING: imported key image differs from previously known key image at index " << i << ": trusting imported one");
				}
				td.m_key_image = key_image;
				m_key_images[key_image] = idx;
				td.m_key_image_known = true;
				m_pub_keys[td.get_public_key()] = idx;
			}

			ptx = arch.txs;

		} else if (type == XMR_DATA_TX_SIGNED) {

			signed_tx_set signed_txs;
			try {
				loadGZBase64String(type, signed_txs, data);
			} catch (...) {
				return "Failed to parse optimized signed tx data";
			}

			// import key images
			if (signed_txs.key_images.size() > m_transfers.size()) {
				return "More key images returned that we know outputs for";
			}

			for (size_t i = 0; i < signed_txs.key_images.size(); ++i) {
				transfer_details &td = m_transfers[i];
				if (td.m_key_image_known && td.m_key_image != signed_txs.key_images[i]) {
					LOG_PRINT_L0("WARNING: imported key image differs from previously known key image at index " << i << ": trusting imported one");
				}
				td.m_key_image = signed_txs.key_images[i];
				m_key_images[m_transfers[i].m_key_image] = i;
				td.m_key_image_known = true;
				m_pub_keys[m_transfers[i].get_public_key()] = i;
			}

			ptx = signed_txs.ptx;

		} else {
			return "Bad magic in signed tx data";
		}

		try {
			commit_tx(ptx);
		} catch (const tools::error::daemon_busy&) {
			return "Daemon is busy";
		} catch (const tools::error::no_connection_to_daemon&) {
			return "No connection to daemon";
		} catch (const tools::error::tx_rejected& e) {
			std::string reason = e.reason();
			return "Transaction was rejected by daemon with status " + e.status() + (reason.empty() ? "" : ", reason " + reason);
		} catch (const std::exception &e) {
			return "Unknown exception " + std::string(e.what()); 
		} catch(const std::runtime_error &e) {
			return std::string("Runtime error when submitting transaction: ") + e.what();
		} catch(const std::exception &e) {
			return std::string("Exception when submitting transaction: ") + e.what();
		} catch (...) {
			return "Unhandled exception"; 
		}

		crypto::hash hash = cryptonote::get_transaction_hash(ptx[0].tx);
		unconfirmed_transfer_details& td = m_unconfirmed_txs[hash];

		infoFromUnconfirmedTransaction(info, hash, td);
		// info.key = epee::string_tools::pod_to_hex(ptx[0].tx_key);

		// LOG_PRINT_L3("transaction " << info.id << " tx_key: [" << ptx[0].key_images << "] key " << info.key);

		// try {
		// 	LOG_ERROR("===== rescanning spent");
		// 	rescan_spent();
		// 	LOG_ERROR("===== rescanning spent done");
		// } catch (...) {
		// 	LOG_ERROR("===== rescanning spent ERROR");
		// }

		return "";
	}

	std::string XMRWallet::exportOutputs(std::string &outputs) {
		try {
			std::vector<tools::wallet2::transfer_details> outs = export_outputs();
			outputs = saveGZBase64String(XMR_DATA_OUTPUTS, outs);
			return "";
		
		} catch (const std::exception &e) {
			return e.what();
		} catch (...) {
			return "Failed to export outputs";
		}
	}

	std::string XMRWallet::importOutputs(std::string &data) {
		try {
			uint32_t type;
			std::vector<tools::wallet2::transfer_details> outputs;
			try {
				loadGZBase64String(type, outputs, data);

				if (type != XMR_DATA_OUTPUTS) {
					throw std::logic_error("Bad data type in importOutputs");
				}
			} catch (const std::exception &e) {
				return e.what();
			} catch (...) {
				return "Failed to import outputs";
			}
			
			import_outputs(outputs);
			return "";
	
		} catch (const std::exception &e) {
			return std::string("Failed to import outputs: ") + e.what();
		} catch (...) {
			return "Failed to import outputs";
		}
	}

	std::string XMRWallet::exportKeyImages(std::string &images) {

		try {
			std::vector<std::pair<crypto::key_image, crypto::signature>> ski = export_key_images();
			images = saveGZBase64String(XMR_DATA_KEY_IMAGES, ski);
			return "";
		
		} catch (const std::exception &e) {
			return e.what();
		} catch (...) {
			return "Failed to export key images";
		}
	}

	std::string XMRWallet::importKeyImages(std::string &data, uint64_t &spent, uint64_t &unspent) {
		try {
			uint32_t type;
			std::vector<std::pair<crypto::key_image, crypto::signature>> ski;
			try {
				loadGZBase64String(type, ski, data);

				if (type != XMR_DATA_KEY_IMAGES) {
					throw std::logic_error("Bad data type in importOutputs");
				}

				if (import_key_images(ski, spent, unspent) == 0) {
					return "Failed to import key images";
				}

				return "";

			} catch (const std::exception &e) {
				return e.what();
			} catch (...) {
				return "Failed to import key images";
			}
			
		} catch (const std::exception &e) {
			return std::string("Failed to import outputs: ") + e.what();
		} catch (...) {
			return "Failed to import outputs";
		}
	}

	std::string XMRWallet::address() {
		return m_account.get_public_address_str(testnet());
	}
	
	XMRAddress XMRWallet::addressDecode(std::string &address_string) {
		XMRAddress addr;
		bool has_payment_id;
		cryptonote::account_public_address address;
		crypto::hash8 payment_id;
		if (!cryptonote::get_account_integrated_address_from_str(address, has_payment_id, payment_id, testnet(), address_string)) {
			return addr;
		}

		addr.address = cryptonote::get_account_address_as_str(testnet(), address);
		if (has_payment_id) {
			std::ostringstream oss;
			oss << payment_id;
			std::string payment_id_str(oss.str());
			addr.payment_id = payment_id_str;
		}
		return addr;
	}
	
	bool XMRWallet::refresh_and_store() {
		try {
			tools::wallet2::refresh();
			// rescan_spent();
			store();
		} catch (...) {
			return false;
		}
		return true;
	}

	std::string XMRWallet::refresh(bool &refreshed) {
		try {
			uint64_t current = get_blockchain_current_height();

			std::string error;
			uint64_t daemon = get_daemon_blockchain_height(error);

			refreshed = false;

			if (error.empty()) {
				if (daemon > current) {
					LOG_ERROR("XMRWallet::refresh current " << current << " daemon " << daemon);
					uint64_t pulled = 0;
					tools::wallet2::refresh(daemon, pulled);
					rescan_spent();
					refreshed = true;
					return "";
				} else {
					LOG_ERROR("XMRWallet::refresh won't refresh");
					return "";
				}
			} else {
				LOG_ERROR("XMRWallet::refresh error: " << error);
				return std::string("-") + error;
			}
		} catch (...) {
			return "-Exception raised when refreshing";
		}
	}

	std::string XMRWallet::transactions(std::string payment_id_str, bool in, bool out, std::vector<XMRTxInfo> &txs) {
		uint64_t min_height = 0;
		uint64_t max_height = (uint64_t)-1;
		uint64_t wallet_height = get_blockchain_current_height();

		crypto::hash payment_id;
		if (!payment_id_str.empty()) {
			if (!tools::wallet2::parse_payment_id(payment_id_str, payment_id)) {
				return "-Cannot parse payment id";
			}
		}

		// incoming transactions
		if (in) {

			if (payment_id_str.empty()) {
				std::list<std::pair<crypto::hash, tools::wallet2::payment_details>> payments;
				get_payments(payments, min_height, max_height);

				for (std::list<std::pair<crypto::hash, tools::wallet2::payment_details>>::const_iterator i = payments.begin(); i != payments.end(); ++i) {
					const tools::wallet2::payment_details &pd = i->second;
					std::string id = epee::string_tools::pod_to_hex(i->first);
					if (id.substr(16).find_first_not_of('0') == std::string::npos){
						id = id.substr(0,16);
					}
					
					XMRTxInfo info;
					info.id = epee::string_tools::pod_to_hex(pd.m_tx_hash);
					info.payment_id = id;
					info.amount = pd.m_amount;
					info.timestamp = pd.m_timestamp;
					info.state = "confirmed";
					info.in = true;

					txs.push_back(info);
				}
			} else {
				std::list<tools::wallet2::payment_details> payments;
				get_payments(payment_id, payments, min_height);

				for (auto pd : payments) {
					XMRTxInfo info;
					info.id = epee::string_tools::pod_to_hex(pd.m_tx_hash);
					info.payment_id = payment_id_str;
					info.amount = pd.m_amount;
					info.timestamp = pd.m_timestamp;
					info.state = "confirmed";
					info.in = true;

					txs.push_back(info);
				}
			}

		}

		// outgoing transaction
		if (out) {
			// successfully processed
			std::list<std::pair<crypto::hash, tools::wallet2::confirmed_transfer_details>> payments;
			get_payments_out(payments, min_height, max_height);
			
			for (std::list<std::pair<crypto::hash, tools::wallet2::confirmed_transfer_details>>::const_iterator i = payments.begin(); i != payments.end(); ++i) {
				const tools::wallet2::confirmed_transfer_details &pd = i->second;
				
				std::string id = epee::string_tools::pod_to_hex(i->second.m_payment_id);
				if (id.substr(16).find_first_not_of('0') == std::string::npos){
					id = id.substr(0,16);
				}

				uint64_t change = pd.m_change == (uint64_t)-1 ? 0 : pd.m_change; // change may not be known
				uint64_t fee = pd.m_amount_in - pd.m_amount_out;

				XMRTxInfo info;
				info.id = epee::string_tools::pod_to_hex(i->first);
				info.payment_id = id;
				crypto::secret_key tx_key;
				if (get_tx_key(i->first, tx_key)) {
					info.key = epee::string_tools::pod_to_hex(tx_key);
				}
				info.amount = pd.m_amount_in - change - fee;
				info.fee = fee;
				info.timestamp = pd.m_timestamp;
				info.state = "confirmed";
				info.in = false;

				for (const auto &d: pd.m_dests) {
					XMRDest dest;
					dest.address = get_account_address_as_str(testnet(), d.addr);
					dest.amount = d.amount;
					info.destinations.push_back(dest);
				}

				if (payment_id_str.empty() || payment_id == i->first || payment_id == i->second.m_payment_id) {
					txs.push_back(info);
				}
			}

			// not yet confirmed
			try {
				update_pool_state();
				
				std::list<std::pair<crypto::hash, tools::wallet2::payment_details>> payments;
				get_unconfirmed_payments(payments);
				
				for (std::list<std::pair<crypto::hash, tools::wallet2::payment_details>>::const_iterator i = payments.begin(); i != payments.end(); ++i) {
					const tools::wallet2::payment_details &pd = i->second;
					std::string id = epee::string_tools::pod_to_hex(i->first);
					
					if (id.substr(16).find_first_not_of('0') == std::string::npos){
						id = id.substr(0,16);
					}

					XMRTxInfo info;
					info.id = epee::string_tools::pod_to_hex(pd.m_tx_hash);
					info.payment_id = id;
					crypto::secret_key tx_key;
					if (get_tx_key(i->first, tx_key)) {
						info.key = epee::string_tools::pod_to_hex(tx_key);
					}
					info.amount = pd.m_amount;
					info.timestamp = pd.m_timestamp;
					info.state = "pool";
					info.in = false;

					if (payment_id_str.empty() || payment_id == i->first) {
						txs.push_back(info);
					}
				}
			} catch (...) {
				return "-Failed to get pool state";
			}

			// not yet sent or failed
			std::list<std::pair<crypto::hash, tools::wallet2::unconfirmed_transfer_details>> upayments;
			get_unconfirmed_payments_out(upayments);
		
			for (std::list<std::pair<crypto::hash, tools::wallet2::unconfirmed_transfer_details>>::const_iterator i = upayments.begin(); i != upayments.end(); ++i) {
				
				XMRTxInfo info;
				infoFromUnconfirmedTransaction(info, i->first, i->second);

				if (payment_id_str.empty() || payment_id == i->first || payment_id == i->second.m_payment_id) {
					txs.push_back(info);
				}

			}
		}

		return "";
	}

	void XMRWallet::infoFromUnconfirmedTransaction(XMRTxInfo &info, crypto::hash hash, tools::wallet2::unconfirmed_transfer_details pd) {
		std::string id = epee::string_tools::pod_to_hex(pd.m_payment_id);
		if (id.substr(16).find_first_not_of('0') == std::string::npos){
			id = id.substr(0,16);
		}

		uint64_t amount = pd.m_amount_in;
		uint64_t fee = amount - pd.m_amount_out;

		info.id = epee::string_tools::pod_to_hex(hash);
		info.payment_id = id;
		crypto::secret_key tx_key;
		if (get_tx_key(hash, tx_key)) {
			info.key = epee::string_tools::pod_to_hex(tx_key);
		}
		info.amount = amount - pd.m_change - fee;
		info.fee = fee;
		info.timestamp = pd.m_timestamp;
		info.in = false;

		for (const auto &d: pd.m_dests) {
			XMRDest dest;
			dest.address = get_account_address_as_str(testnet(), d.addr);
			dest.amount = d.amount;
			info.destinations.push_back(dest);
		}
		
		if (pd.m_state == tools::wallet2::unconfirmed_transfer_details::failed) {
			info.error = "failed";
			info.state = "failed";
		} else {
			info.state = "pending";
		}
	}
}