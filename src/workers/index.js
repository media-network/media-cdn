import rpc from 'libs/message-bus'
import config from 'infrastructure/config'

import cache from 'services/cache'
import crawler from 'services/crawler'
import optimizer from 'services/optimizer'

const { amq: { host, prefix } } = config

const crawl = async (producer, payload) => {
  return new Promise((resolve, reject) => {
    producer.request()
      .content({
        job: 'crawl',
        payload: {
          url: payload.url,
          origin: payload.origin
        }
      })
      .sendTo('worker')
      .ttl(10e3)
      .onReply(async (error, content) => {
        console.log('crawl... done')

        resolve()
      })
      .send()
  })
}

const optimize = async (producer, payload) => {
  return new Promise((resolve, reject) => {
    producer.request()
      .content({
        job: 'optimize',
        payload: {
          origin: payload.origin,
          target: payload.target
        }
      })
      .sendTo('worker')
      .ttl(10e3)
      .onReply(async (error, content) => {
        console.log('optimize... done')

        resolve()
      })
      .send()
  })
}

const main = async () => {
  const [ consumer, producer ] = await Promise.all([
    rpc.createConsumer({
      name: 'worker',
      host,
      prefix
    }).connect(),
    rpc.createProducer({
      name: `worker-distributor-${Date.now()}`,
      host,
      prefix
    }).connect()
  ])

  consumer.onMessage(async (content) => {
    const { job, payload } = content

    switch (job) {
      case 'process':
        await crawl(producer, payload)

        await optimize(producer, payload)

        return { succeed: true }

      case 'crawl':
        console.log('crawl...', payload)

        const meta = await cache.head(payload.origin)

        if (!meta) {
          const localPath = await crawler.crawl(payload.url)

          await cache.put(payload.origin, localPath)
        }

        return { succeed: true }

      case 'optimize':
        console.log('optimize...', payload)

        const origin = await cache.get(payload.origin)

        const target = await optimizer.optimize(origin, {})

        await cache.put(payload.target, target)

        return { succeed: true }
    }

    return { succeed: false }
  })

  console.log('worker bootstrapped')
}

main()
