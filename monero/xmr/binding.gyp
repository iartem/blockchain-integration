{
	"targets": [{
		"target_name": "xmr",
		"sources": [ "wallet/wallet2.cpp", "index.cc", "xmrwallet.cc", "xmr.cc" ],
		"libraries": [ 
			# "/usr/local/monero/monero-src/lib/libwallet_merged.a", 
		],
		"include_dirs": [
			"/usr/local/monero/src/",
			"/usr/local/monero/src/wallet/",
			"/usr/local/monero/external/",
			"/usr/local/monero/contrib/epee/include",
			"/usr/local/monero/external/easylogging++"
		],
		"cflags_cc!": [ "-fno-rtti", "-fno-exceptions" ],
		"cflags!": [ "-fno-exceptions" ],
		"link_settings": {
			"libraries": [
				"/usr/lib/x86_64-linux-gnu/libboost_serialization.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_filesystem.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_system.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_thread.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_regex.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_iostreams.so.1.58.0",
				"/usr/lib/x86_64-linux-gnu/libboost_program_options.so.1.58.0",
				"/usr/lib/libwallet.so",
				# "/usr/local/monero/src/cryptonote_core/libcryptonote_core.so",
				# "/usr/local/monero/src/mnemonics/libmnemonics.so",
				# "/usr/local/monero/src/multisig/libmultisig.so",
				# "/usr/local/monero/src/libversion.so",
				# "/usr/local/monero/src/ringct/libringct.so",
				# "/usr/local/monero/src/cryptonote_basic/libcryptonote_basic.so",
				# "/usr/local/monero/src/cryptonote_core/libcryptonote_core.so",
				# "/usr/local/monero/src/checkpoints/libcheckpoints.so",
				# "/usr/local/monero/src/common/libcommon.so",
				# "/usr/local/monero/src/crypto/libcncrypto.so",
				# "/usr/local/monero/external/easylogging++/libeasylogging.so",
				# "/usr/local/monero/src/blockchain_db/libblockchain_db.so",
				# "/usr/local/monero/external/db_drivers/liblmdb/liblmdb.so",
			]
		}
	}]
}