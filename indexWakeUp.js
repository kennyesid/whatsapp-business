
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// 1. Inicializamos el cliente con autenticación local 
// para que no tengas que escanear el QR cada vez que reinicies
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // ¡Aquí está la magia! No abre ventana.
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 2. Generar el código QR en la terminal para el primer inicio
client.on('qr', (qr) => {
    console.log('ESCANEAME CON TU CELULAR (WhatsApp > Dispositivos vinculados):');
    qrcode.generate(qr, { small: true });
});

// 3. Confirmar cuando el cliente esté listo
client.on('ready', () => {
    console.log('¡Conexión exitosa! El bot está listo.');

    // Ejemplo: Enviar un mensaje de prueba
    // Formato: código_país + número + @c.us (Sin el +)
    const numeroBolivia = '59168090579@c.us'; 
    const mensaje = 'Notificación desde Node.js: ¡El sistema está corriendo! 🚀';

    client.sendMessage(numeroBolivia, mensaje)
        .then(response => console.log('Mensaje enviado correctamente.'))
        .catch(err => console.error('Error al enviar:', err));
});

client.initialize();