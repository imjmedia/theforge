RN-01. Un usuario verificado puede recibir, transferir y pagar con saldo en pesos entre usuarios sin costo por transferencia.
RN-02. Ningún movimiento puede dejar un saldo negativo; si el saldo es insuficiente, la operación se rechaza y el intento queda registrado.
RN-03. Cada transacción es idempotente: repetir la misma solicitud con la misma clave no genera un segundo cargo.
RN-04. Los límites diarios dependen del nivel de verificación: nivel 1 hasta 3,000 pesos y nivel 2 hasta 20,000 pesos.
RN-05. Los retiros y los cambios de correo o teléfono exigen un segundo factor de autenticación.
RN-06. La conciliación diaria compara los movimientos contra el archivo del banco; las diferencias se listan para revisión de operaciones antes de las 10:00.
RN-07. Reportes mensuales para cumplimiento con operaciones superiores a 10,000 pesos y con alertas de fraude abiertas.
RN-08. La bitácora de accesos y movimientos no puede modificarse ni borrarse.
RN-09. Los datos personales se conservan cinco años desde la última operación y después se anonimizan.
RN-10. Fuera de alcance en esta fase: crédito, inversiones y pagos internacionales.