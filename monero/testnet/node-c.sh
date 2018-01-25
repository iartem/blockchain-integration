#!/bin/sh

exec /usr/local/bin/monerod --testnet --no-igd --hide-my-port --testnet-data-dir /usr/local/node-c \
	--p2p-bind-ip 127.0.0.1 \
	--rpc-bind-ip 0.0.0.0 \
	--allow-local-ip \
	--non-interactive \
	--confirm-external-bind \
	--testnet-p2p-bind-port 48080 \
	--testnet-rpc-bind-port 48081 \
	--add-exclusive-node 127.0.0.1:28080 \
	--add-exclusive-node 127.0.0.1:38080 \
	--start-mining 9yuUgPwhkxuZcMvnMGNtPGHv7tfyjhUiJFthfEfBPZWmTicL7LLzEaYfskyv6GPzV47v24A6JqgvDCws2JzHduCd3GmRXEB \
	--mining-threads 1 \
	--log-level 0
