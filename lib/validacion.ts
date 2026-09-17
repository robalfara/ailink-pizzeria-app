/**
 * Validación de los formularios de auth.
 *
 * A mano y sin dependencias: son tres campos. Cuando lleguen los pedidos
 * (carrito, direcciones, líneas con precios) tocará meter zod y entonces sí
 * compensará.
 *
 * Esto valida la FORMA de los datos, no la autorización. Toda action tiene que
 * comprobar la sesión por su cuenta aunque lo de aquí pase.
 */

export type ErroresFormulario = {
  nombre?: string[];
  email?: string[];
  password?: string[];
};

export type EstadoFormulario =
  | {
      errores?: ErroresFormulario;
      /** Mensaje general: error de Supabase, o confirmación de alta. */
      mensaje?: string;
      exito?: boolean;
      /** Para repintar el formulario sin perder lo que ya había escrito. */
      valores?: { nombre?: string; email?: string };
    }
  | undefined;

const MINIMO_PASSWORD = 8;

// Deliberadamente laxo: la validación de verdad de un email es mandarlo.
// Aquí solo se atajan los errores de dedo evidentes.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function texto(datos: FormData, campo: string) {
  const valor = datos.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function validarEmail(valor: string, errores: ErroresFormulario) {
  if (!valor) {
    errores.email = ["Escribe tu email."];
  } else if (!FORMATO_EMAIL.test(valor)) {
    errores.email = ["Ese email no parece válido."];
  }
}

function hayErrores(errores: ErroresFormulario) {
  return Object.keys(errores).length > 0;
}

export function validarLogin(datos: FormData) {
  const email = texto(datos, "email");
  const password = datos.get("password");
  const errores: ErroresFormulario = {};

  validarEmail(email, errores);

  // En login no se exige longitud mínima: la contraseña puede ser antigua y
  // haberse creado con otras reglas. Solo que no esté vacía.
  if (typeof password !== "string" || password.length === 0) {
    errores.password = ["Escribe tu contraseña."];
  }

  if (hayErrores(errores)) return { ok: false as const, errores, email };

  return {
    ok: true as const,
    datos: { email, password: password as string },
  };
}

export function validarRegistro(datos: FormData) {
  const nombre = texto(datos, "nombre");
  const email = texto(datos, "email");
  const password = datos.get("password");
  const errores: ErroresFormulario = {};

  if (nombre.length < 2) {
    errores.nombre = ["Dinos cómo te llamas (al menos 2 letras)."];
  }

  validarEmail(email, errores);

  if (typeof password !== "string" || password.length < MINIMO_PASSWORD) {
    errores.password = [
      `La contraseña necesita al menos ${MINIMO_PASSWORD} caracteres.`,
    ];
  }

  if (hayErrores(errores)) return { ok: false as const, errores, nombre, email };

  return {
    ok: true as const,
    datos: { nombre, email, password: password as string },
  };
}

export function validarPerfil(datos: FormData) {
  const nombre = texto(datos, "nombre");
  const telefono = texto(datos, "telefono");
  const errores: ErroresFormulario = {};

  if (nombre.length < 2) {
    errores.nombre = ["El nombre necesita al menos 2 letras."];
  }

  if (hayErrores(errores)) return { ok: false as const, errores };

  return { ok: true as const, datos: { nombre, telefono } };
}

/**
 * Solo se admiten rutas internas como destino tras el login.
 *
 * Sin esto, `?siguiente=https://sitio-falso.com` convertiría la pantalla de
 * login en un trampolín para phishing: el enlace saldría de tu dominio, que es
 * justo lo que la víctima comprueba antes de fiarse.
 */
export function destinoSeguro(valor: FormDataEntryValue | null): string {
  const predeterminado = "/cuenta";

  if (typeof valor !== "string" || !valor.startsWith("/")) {
    return predeterminado;
  }

  // "//evil.com" y "/\evil.com" son URLs protocol-relative: salen del sitio
  // aunque empiecen por barra.
  if (valor.startsWith("//") || valor.startsWith("/\\")) {
    return predeterminado;
  }

  return valor;
}

/**
 * Validación del mensaje que llega al chat del agente.
 *
 * Aquí no hay FormData: el widget habla con un Route Handler por JSON, así que
 * lo que llega es `unknown` de verdad y hay que estrecharlo a mano.
 *
 * El tope de 1000 caracteres no es cosmético. Cada carácter que entra son
 * tokens que se pagan, y los mensajes larguísimos son además el vehículo
 * habitual de una inyección de prompt: nadie pregunta por la carta en tres mil
 * palabras.
 */
export const MAXIMO_MENSAJE = 1000;

/**
 * Formato UUID canónico, en un solo sitio.
 *
 * Estaba copiado byte a byte aquí y en `app/api/chat/route.ts`. Dos copias de
 * la misma regla son dos cosas que corregir cuando cambie una: bastaba con que
 * alguien relajase una de las dos para que el identificador dejara de ser un
 * UUID justo en el lado que importa.
 *
 * Sin flag `g` a propósito: un regex global guarda `lastIndex` entre llamadas y
 * un `test()` compartido empezaría a fallar una de cada dos veces.
 */
export const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarMensajeChat(cuerpo: unknown) {
  if (typeof cuerpo !== "object" || cuerpo === null) {
    return { ok: false as const, motivo: "El cuerpo no es un objeto." };
  }

  const { texto, mensajeId } = cuerpo as Record<string, unknown>;

  if (typeof texto !== "string" || texto.trim().length === 0) {
    return { ok: false as const, motivo: "Falta el texto del mensaje." };
  }

  if (texto.length > MAXIMO_MENSAJE) {
    return {
      ok: false as const,
      motivo: `El mensaje no puede pasar de ${MAXIMO_MENSAJE} caracteres.`,
    };
  }

  // Lo genera el navegador con crypto.randomUUID(). Se exige el formato para
  // que no sirva de comodín: el servidor lo va a usar como clave de
  // idempotencia y una cadena libre permitiría colisiones a propósito.
  if (typeof mensajeId !== "string" || !FORMATO_UUID.test(mensajeId)) {
    return { ok: false as const, motivo: "El identificador no es un UUID." };
  }

  return { ok: true as const, datos: { texto: texto.trim(), mensajeId } };
}
