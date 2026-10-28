/**
 * ESB Studio — Native SMTP Mailer & File Reader Engine
 * Runs in Electron Main Process. Handles RFC-5322 MIME transport, attachments, and Excel loading.
 */

const fs = require('node:fs')
const path = require('node:path')
const nodemailer = require('nodemailer')
const XLSX = require('xlsx')

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.smtpHost || 'smtp.gmail.com',
    port: Number(config.smtpPort) || 587,
    secure: Boolean(config.secure),
    auth: {
      user: config.senderEmail,
      pass: config.senderPassword,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  })
}

/**
 * Sends a single email with attachments, HTML/plain dual MIME, and tracking pixel.
 */
async function sendOutreachEmail(config, mail) {
  try {
    const transporter = createTransport(config)
    
    // Format attachments for Nodemailer
    const mailAttachments = (mail.attachments || []).map((att) => {
      if (att.dataUrl && att.dataUrl.startsWith('data:')) {
        const matches = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        if (matches) {
          return {
            filename: att.name,
            content: Buffer.from(matches[2], 'base64'),
            contentType: matches[1],
            cid: att.cid, // For inline images
          }
        }
      } else if (att.path && fs.existsSync(att.path)) {
        return {
          filename: att.name,
          path: att.path,
        }
      }
      return {
        filename: att.name,
        content: att.dataUrl || '',
      }
    })

    const sender = `"${config.senderName || 'ESB PowerLine'}" <${config.senderEmail}>`

    const info = await transporter.sendMail({
      from: sender,
      to: mail.to,
      subject: mail.subject,
      text: mail.text || mail.html.replace(/<[^>]+>/g, ''),
      html: mail.html,
      attachments: mailAttachments,
      headers: {
        'X-Mailer': 'ESB PowerLine Outreach Studio (Windows Native)',
        'Reply-To': config.senderEmail,
        ...(mail.isTest ? { 'X-ESB-Test-Dispatch': 'true' } : {}),
      },
    })

    return { success: true, messageId: info.messageId }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

/**
 * Reads workbook file directly from disk.
 */
function loadWorkbookFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    const buffer = fs.readFileSync(filePath)
    return { success: true, data: buffer }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

module.exports = {
  sendOutreachEmail,
  loadWorkbookFile,
}
