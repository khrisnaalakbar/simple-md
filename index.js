import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, makeCacheableSignalKeyStore } from 'baileys'
import pino from 'pino'
import chalk from 'chalk'
import readline from 'readline'
import moment from 'moment-timezone'

const usePairingCode = true

const question = (text) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            resolve(answer)
            rl.close()
        })
    })
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const { version } = await fetchLatestWaWebVersion()

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }).child({ level: "store" })),
        },
        generateHighQualityLinkPreview: true,
    })

    if (usePairingCode && !sock.authState.creds.registered) {
        console.log(chalk.yellow('Silakan masukkan nomor WhatsApp untuk Pairing Code:'))
        const phoneNumber = await question(chalk.yellow('Nomor (contoh: 628xxx): '))
        const code = await sock.requestPairingCode(phoneNumber.trim())
        console.log(chalk.green(`Kode Pairing Anda: ${code}`))
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log(chalk.red('Koneksi terputus, mencoba menghubungkan ulang...'), shouldReconnect)
            if (shouldReconnect) {
                startBot()
            }
        } else if (connection === 'open') {
            console.log(chalk.green('Terhubung ke WhatsApp'))
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async chatUpdate => {
        try {
            let m = chatUpdate.messages[0]
            if (!m.message) return
            
            m.message = (Object.keys(m.message)[0] === 'ephemeralMessage') ? m.message.ephemeralMessage.message : m.message
            if (m.key && m.key.remoteJid === 'status@broadcast') return

            const from = m.key.remoteJid
            const type = Object.keys(m.message)[0]
            const body = (type === 'conversation') ? m.message.conversation : 
                         (type == 'imageMessage') ? m.message.imageMessage.caption : 
                         (type == 'videoMessage') ? m.message.videoMessage.caption : 
                         (type == 'extendedTextMessage') ? m.message.extendedTextMessage.text : ''
            
            const isGroup = from.endsWith('@g.us')
            const sender = isGroup ? (m.key.participant ? m.key.participant : m.participant) : m.key.remoteJid
            const senderNumber = sender.split('@')[0]
            const pushname = m.pushName || "Tanpa Nama"
            
            console.log(chalk.bgGreen.black(' PESAN BARU '))
            console.log(chalk.cyan(` > Dari: ${pushname} (${senderNumber})`))
            console.log(chalk.cyan(` > Di: ${isGroup ? 'Grup' : 'Personal Chat'}`))
            console.log(chalk.blue(` > Tipe: ${type}`))
            console.log(chalk.yellow(` > Waktu: ${moment().tz('Asia/Jakarta').format('HH:mm:ss')}`))
            console.log(chalk.white(` > Isi: ${body || '[Media/Stiker/Lainnya]'}`))
            console.log(chalk.gray('--------------------------------------------------'))

            if (body.trim().toLowerCase() === '.ping') {
                await sock.sendMessage(from, { text: 'pong' }, { quoted: m })
            }

        } catch (e) {
            console.log(e)
        }
    })
}

startBot()

