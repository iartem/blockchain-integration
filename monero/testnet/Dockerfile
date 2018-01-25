FROM phusion/baseimage:0.9.22

RUN mkdir /usr/local/node-a && mkdir /usr/local/node-b && mkdir /usr/local/node-c && \
	apt-get update && apt-get install -y wget bzip2 && \
	wget https://dlsrc.getmonero.org/cli/monero-linux-x64-v0.11.1.0.tar.bz2 && \
	tar xjf monero-linux-x64-v0.11.1.0.tar.bz2 && rm monero-linux-x64-v0.11.1.0.tar.bz2 && \
	mv monero-v0.11.1.0/* /usr/local/bin && rm -rf monero-v0.11.1.0

RUN mkdir /etc/service/node-a && mkdir /etc/service/node-b && mkdir /etc/service/node-c

COPY node-a.sh /etc/service/node-a/run
COPY node-b.sh /etc/service/node-b/run
COPY node-c.sh /etc/service/node-c/run

RUN chmod +x /etc/service/node-a/run && chmod +x /etc/service/node-b/run && chmod +x /etc/service/node-c/run

EXPOSE 28080 38080 48080 28081 38081 48081

CMD ["/sbin/my_init"]

RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*