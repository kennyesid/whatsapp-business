const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");
const { default: puppeteer } = require("puppeteer");
const app = express();
const port = 3000;
const cors = require("cors");
const multer = require("multer");
const upload = multer();

app.use(cors());
app.use(express.json());

// Guardamos el estado del QR globalmente
let lastQr = "";

const client = new Client({
  authStrategy: new LocalAuth(), // Guarda la sesión en la carpeta .wwebjs_auth
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Evento: Generar QR
client.on("qr", (qr) => {
  lastQr = qr; // Guardamos el código para servirlo por API
  console.log("Nuevo QR generado. Listo para ser escaneado.");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  lastQr = "CONNECTED";
  console.log("Cliente de WhatsApp está listo.");
});

// --- ENDPOINTS REST ---

// 1. Obtener el QR (para tu frontend o Postman)
app.get("/connect", (req, res) => {
  res.json({
    status: "client connect successfully",
  });
});

// 1. Obtener el QR (para tu frontend o Postman)
app.get("/status", (req, res) => {
  res.json({
    status: lastQr === "CONNECTED" ? "Conectado" : "Esperando QR",
    qr: lastQr,
  });
});

app.get("/qr-base64", async (req, res) => {
  if (lastQr === "CONNECTED") {
    return res.json({
      connected: true,
      message: "Ya estás conectado a WhatsApp",
      qr: null,
    });
  }

  if (!lastQr) {
    return res.json({
      connected: false,
      message: "Generando QR, espera unos segundos...",
      qr: null,
    });
  }

  try {
    // CONVERTIR el token a imagen QR base64
    const qrBase64 = await QRCode.toDataURL(lastQr, {
      width: 300,
      margin: 2,
    });

    // Devolver el QR real en base64
    res.json({
      connected: false,
      message: "QR generado, escanea con WhatsApp",
      qr: qrBase64, // ← Esto SÍ es una imagen base64 válida
    });
  } catch (error) {
    console.error("Error generando QR:", error);
    res.status(500).json({
      connected: false,
      message: "Error generando QR",
      qr: null,
    });
  }
});

// 2. Enviar Mensaje
app.post("/send-message", async (req, res) => {
  const { number, message } = req.body; // Recibe: "59168090579", "Hola"

  if (lastQr !== "CONNECTED") {
    return res
      .status(500)
      .json({ error: "El bot no está autenticado todavía." });
  }

  try {
    const chatId = number.includes("@c.us") ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ success: true, message: "Enviado correctamente" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/send-message-html-form", upload.none(), async (req, res) => {
  if (lastQr !== "CONNECTED") {
    return res.status(503).json({
      error: "WhatsApp no está listo",
    });
  }

  let browser;
  try {
    // 2. Obtener datos del body
    const { number, content_html, caption } = req.body;

    // 3. Validar campos requeridos
    if (!number) {
      return res.status(400).json({ error: "El campo 'number' es requerido" });
    }

    if (!content_html) {
      return res
        .status(400)
        .json({ error: "El campo 'content_html' es requerido" });
    }

    // 4. Decodificar HTML de base64
    let htmlContent;
    try {
      htmlContent = Buffer.from(content_html, "base64").toString("utf-8");
    } catch (decodeError) {
      return res.status(400).json({
        error: "El content_html no es un base64 válido",
      });
    }

    // 5. Configurar mensaje por defecto si no viene caption
    const panelInformativo =
      caption || "Este es un mensaje automático, por favor no responder.";

    // 6. Lanzar puppeteer y generar imagen
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Configurar viewport para mejor calidad
    await page.setViewport({
      width: 800,
      height: 600,
      deviceScaleFactor: 2, // Mejor calidad
    });

    // Cargar el HTML
    await page.setContent(htmlContent, {
      waitUntil: "networkidle0", // Esperar a que carguen recursos
    });

    // Esperar un momento para que se renderice todo
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Tomar screenshot del body
    const element = await page.$("body");
    if (!element) {
      throw new Error("No se encontró el elemento body en el HTML");
    }

    const imageBuffer = await element.screenshot({
      encoding: "base64",
      type: "png",
      omitBackground: true, // Fondo transparente
    });

    await browser.close();

    // 7. Crear y enviar mensaje con imagen
    const media = new MessageMedia("image/png", imageBuffer);
    const chatId = number.includes("@c.us") ? number : `591${number}@c.us`;

    const response = await client.sendMessage(chatId, media, {
      caption: panelInformativo,
    });

    // 8. Responder éxito
    res.json({
      success: true,
      message: "Mensaje con imagen enviado correctamente",
      code: 200,
      data: {
        id: response.id._serialized,
        number: number,
        image_size: imageBuffer.length,
        caption: panelInformativo,
      },
    });
  } catch (error) {
    console.error("Error enviando mensaje con imagen:", error);

    // Cerrar browser si está abierto
    if (browser) {
      await browser.close().catch(console.error);
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 3. Enviar Mensaje con html

app.post("/send-message-html", async (req, res) => {
  // 1. Validar estado antes de empezar
  if (lastQr !== "CONNECTED") {
    return res.status(503).json({ error: "WhatsApp no está listo." });
  }

  let browser;
  try {
    // const { number } = req.body;
    const number = "59168090579";
    // const number = "59170205050";

    // Lanzamos puppeteer
    browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            * { box-sizing: border-box; }
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; width: 480px; margin: 0; padding: 0; background-color: #f4f7f6; }
            .ticket { background: white;  overflow: hidden; border: 1px solid #ddd; }
            
            /* Cabecera Solicitada */
            .header { 
                background: #0c4a6f; 
                color: white; 
                padding: 5px 20px; 
                display: flex; 
                align-items: center;
            }
            .logo-placeholder { 
                width: 40px; height: 40px; 
                background: white; border-radius: 4px; 
                display: flex; align-items: center; justify-content: center;
                color: #003366; font-weight: bold; font-size: 20px;
            }
            .savi-title { 
                flex-grow: 1; text-align: center; 
                font-size: 22px; font-weight: 200; letter-spacing: 5px; 
                margin-left: -40px; /* Compensa el logo para centrar perfecto */
            }

            .body { padding: 25px; }
            
            /* Secciones */
            .section-label { color: #888; font-size: 11px; text-transform: letter-spacing: 1px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 3px;}
            
            .info-block { margin-bottom: 20px; }
            .main-val { font-size: 16px; font-weight: bold; color: #222; margin: 0; }
            .sub-val { font-size: 13px; color: #555; margin: 2px 0 0 0; }

            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
            .grid-item label { display: block; font-size: 11px; color: #999; margin-bottom: 2px; }
            .grid-item span { font-size: 14px; color: #333; font-weight: 500; }

            .reason-card { background: #fff9db; padding: 12px; border-radius: 6px; border-left: 4px solid #fcc419; font-size: 13px; line-height: 1.4; color: #444; margin-bottom: 20px; }

            /* Tabla de Itinerario */
            table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
            th { text-align: left; padding: 10px; border-bottom: 2px solid #003366; color: #003366; }
            td { padding: 10px; border-bottom: 1px solid #eee; }
            .dest { font-weight: bold; color: #003366; }

            /* Resumen de Viáticos */
            .total-box { 
                background: #0c4a6f; color: white; 
                padding: 15px; border-radius: 8px; 
                display: flex; justify-content: space-between; align-items: center;
            }
            .total-label { font-size: 12px; opacity: 0.8; }
            .total-amount { font-size: 20px; font-weight: bold; }

            .footer { padding: 15px; text-align: center; font-size: 10px; color: #aaa; background: #fafafa; border-top: 1px solid #eee; }
			
			/* Contenedor del Itinerario tipo Vuelo */
.flight-body {
    background: #fdfdfd;
    border: 1px dashed #ccc;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 15px;
}

.route-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: center;
}

.airport {
    flex: 1;
}

.airport-name {
    font-size: 10px;
    color: #999;
    text-transform: uppercase;
}

.airport-code {
    font-size: 18px;
    font-weight: bold;
    color: #003366;
    margin: 2px 0;
}

.flight-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
}

/* Línea punteada entre aeropuertos */
.flight-details::before {
    content: "";
    position: absolute;
    top: 20px;
    left: -20%;
    right: -20%;
    border-top: 2px dotted #003366;
    z-index: 1;
    opacity: 0.3;
}

.plane-icon {
    background: white;
    z-index: 2;
    padding: 0 10px;
    color: #003366;
    font-size: 20px;
}

.flight-duration {
    font-size: 11px;
    color: #666;
    margin-top: 15px;
}

.hotel-info {
    font-size: 10px;
    color: #28a745;
    font-weight: bold;
    margin-top: 2px;
}
        </style>
    </head>
    <body>
        <div class="ticket">
            <div class="header">
                <img src="data:image/png;base64,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" alt="Logo SAVI" style="width: 60px; height: 60px; object-fit: contain;">
                <div class="savi-title">SAVI</div>
            </div>
            
            <div class="body">
                <div class="info-block">
                    <div class="section-label">Solicitante</div>
                    <p class="main-val">Riovaldo Telleria Cruz</p>
                    <p class="sub-val">JEFE DE UNIDAD DE INFRAESTRUCTURA Y SOPORTE</p>
                </div>

                <div class="grid">
                    <div class="grid-item">
                        <label>Lugar de Trabajo</label>
                        <span>OFICINA CENTRAL</span>
                    </div>
                    <div class="grid-item">
                        <label>Unidad Org.</label>
                        <span>DTI/INFRA</span>
                    </div>
                    <div class="grid-item">
                        <label>Centro de Costo</label>
                        <span>R170-707.1</span>
                    </div>
                    <div class="grid-item">
                        <label>Gerencia</label>
                        <span>GAF/ADMC</span>
                    </div>
                </div>

                <div class="section-label">Motivo del Viaje</div>
                <div class="reason-card">
                    prueba de mensajes instantaneos de whatsapp
                </div>

                <div class="section-label">Itinerario de Viaje</div>

<div class="flight-body">
    <div class="route-container">
        <div class="airport">
            <div class="airport-name">Origen</div>
            <div class="airport-code">Santa Cruz</div>
            <div class="airport-name">Oficina Central</div>
        </div>

        <div class="flight-details">
            <div class="plane-icon">✈️</div>
            <div class="flight-duration">17/02/2026 22:32</div>
            </div>

        <div class="airport">
            <div class="airport-name">Destino</div>
            <div class="airport-code">Oruro</div>
            <div class="airport-name">Planta Industrial</div>
        </div>
    </div>
</div>

<div class="flight-body">
    <div class="route-container">
        <div class="airport">
            <div class="airport-name">Origen</div>
            <div class="airport-code">Oruro</div>
            <div class="airport-name">Planta Industrial</div>
        </div>

        <div class="flight-details">
            <div class="plane-icon">✈️</div>
            <div class="flight-duration">18/02/2026 02:32</div>
        </div>

        <div class="airport">
            <div class="airport-name">Destino</div>
            <div class="airport-code">Santa Cruz</div>
            <div class="airport-name">Oficina Central</div>
        </div>
    </div>
</div>

                <div class="total-box">
                    <span class="total-label">TOTAL VIÁTICOS SOLICITADOS</span>
                    <span class="total-amount">140.00 BOB</span>
                </div>
                
                <p style="font-size: 11px; color: #777; margin-top: 15px; text-align: center;">
                    <b>Autorizador:</b> Julio Cesar Camargo Perez (BOZ9)
                </p>
            </div>
            
            <div class="footer">
                SISTEMA SAVI | BOLIVIA 2026
            </div>
        </div>
    </body>
    </html>
    `;
    await page.setContent(htmlContent);

    const element = await page.$("body");
    const imageBuffer = await element.screenshot({ encoding: "base64" });
    await browser.close();

    const media = new MessageMedia("image/png", imageBuffer);
    const chatId = number.includes("@c.us") ? number : `${number}@c.us`;

    const panelInformativo = `Este es un mensaje automático, por favor no responder.`;

    // EL CAMBIO CLAVE: Esperar el envío y responder al cliente HTTP
    const response = await client.sendMessage(chatId, media, {
      caption: panelInformativo,
    });

    // Si no envías esta respuesta, el cliente se queda esperando y el proceso falla
    res.json({
      success: true,
      message: "Mensaje enviado",
      id: response.id._serialized,
    });
  } catch (error) {
    if (browser) await browser.close();
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// app.post("/send-message-html", async (req, res) => {
//   const browser = await puppeteer.launch();
//   const page = await browser.newPage();
//   const { number, message } = req.body;
//   // 1. Definimos el HTML/CSS (puedes usar variables de JS aquí)
//   try {
//     if (lastQr !== "CONNECTED") {
//       return res.status(503).json({ error: "WhatsApp no está listo." });
//     }

//     const htmlContent = `
//     <html>
//     <head>
//         <style>
//             body { font-family: Arial; width: 400px; padding: 20px; background: #f0f2f5; }
//             .card { background: white; border-radius: 10px; padding: 20px; border-top: 5px solid #25d366; }
//             h2 { color: #075e54; margin-top: 0; }
//             .total { font-size: 24px; font-weight: bold; color: #333; }
//             .footer { font-size: 10px; color: #777; margin-top: 20px; }
//         </style>
//     </head>
//     <body>
//         <div class="card">
//             <h2>AVISO DE PAGO</h2>
//             <p>Hola <b>test</b>,</p>
//             <p>Tu saldo pendiente en Bolivia es:</p>
//             <div class="total">test BOB</div>
//             <div class="footer">Generado automáticamente el ${new Date().toLocaleDateString()}</div>
//         </div>
//     </body>
//     </html>`;

//     await page.setContent(htmlContent);

//     // 2. Tomamos la captura (solo del contenido)
//     const element = await page.$("body");
//     const imageBuffer = await element.screenshot({ encoding: "base64" });

//     await browser.close();

//     // 3. Convertimos a Media de WhatsApp y enviamos
//     const media = new MessageMedia("image/png", imageBuffer);
//     await client.sendMessage(`${number}@c.us`, media, {
//       caption: "Aquí tienes tu reporte.",
//     });
//     res.json({ success: true, message: "Enviado correctamente" });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

app.listen(port, () => {
  console.log(`Servidor REST corriendo en http://localhost:${port}`);
  client.initialize();
});

// const { Client, LocalAuth } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');

// // 1. Inicializamos el cliente con autenticación local
// // para que no tengas que escanear el QR cada vez que reinicies
// const client = new Client({
//     authStrategy: new LocalAuth(),
//     puppeteer: {
//         headless: true, // ¡Aquí está la magia! No abre ventana.
//         args: ['--no-sandbox', '--disable-setuid-sandbox']
//     }
// });

// // 2. Generar el código QR en la terminal para el primer inicio
// client.on('qr', (qr) => {
//     console.log('ESCANEAME CON TU CELULAR (WhatsApp > Dispositivos vinculados):');
//     qrcode.generate(qr, { small: true });
// });

// // 3. Confirmar cuando el cliente esté listo
// client.on('ready', () => {
//     console.log('¡Conexión exitosa! El bot está listo.');

//     // Ejemplo: Enviar un mensaje de prueba
//     // Formato: código_país + número + @c.us (Sin el +)
//     const numeroBolivia = '59168090579@c.us';
//     const mensaje = 'Notificación desde Node.js: ¡El sistema está corriendo! 🚀';

//     client.sendMessage(numeroBolivia, mensaje)
//         .then(response => console.log('Mensaje enviado correctamente.'))
//         .catch(err => console.error('Error al enviar:', err));
// });

// client.initialize();
