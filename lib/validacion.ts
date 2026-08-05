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
