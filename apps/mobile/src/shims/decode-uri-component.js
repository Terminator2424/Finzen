/**
 * Sustituto seguro de `decode-uri-component@0.2.2` (CVE/GHSA-vcc3-ghjq-m6fr).
 *
 * La versión original tiene un caso exponencial: una URL con muchos "%" mal formados
 * (p. ej. un enlace profundo finzen://...) puede congelar la app. Esta versión es lineal:
 * intenta la decodificación nativa y, si falla, decodifica solo las secuencias %XX válidas
 * una por una dejando el resto tal cual. Metro la usa en lugar del paquete (ver metro.config.js).
 */
'use strict';

module.exports = function decodeUriComponent(encoded) {
  if (typeof encoded !== 'string') {
    throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encoded + '`');
  }
  try {
    return decodeURIComponent(encoded);
  } catch (_) {
    return encoded.replace(/(?:%[0-9A-Fa-f]{2})+/g, function (run) {
      try {
        return decodeURIComponent(run);
      } catch (_e) {
        // La racha no es UTF-8 válido: se decodifica byte a byte lo que sea ASCII y se deja el resto.
        return run.replace(/%[0-9A-Fa-f]{2}/g, function (b) {
          var code = parseInt(b.slice(1), 16);
          return code < 0x80 ? String.fromCharCode(code) : b;
        });
      }
    });
  }
};
