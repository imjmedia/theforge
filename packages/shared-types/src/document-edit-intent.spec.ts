import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasEmbeddedSpecificationBlock,
  isHypotheticalDocumentEditOffer,
  isUserExploringDbgaIntent,
  looksLikeApiEndpointCatalog,
  looksLikeDbgaDocumentBody,
  looksLikeDbgaEditRequest,
  looksLikeDbgaSpecIntegrationRequest,
  looksLikeProjectFactStatement,
} from "./document-edit-intent.js";

describe("looksLikeApiEndpointCatalog", () => {
  it("detecta lista de endpoints de chat externo", () => {
    const msg = `Aquí tienes la lista simplificada de los endpoints esenciales:
1. Gestión de Sesión
POST /v1/chats — Crea una nueva sesión.
GET /v1/chats/{chat_id} — Historial.
DELETE /v1/chats/{chat_id} — Cierra.
2. Mensajería
POST /v1/chats/{chat_id}/messages
POST /v1/chats/{chat_id}/messages/stream
3. Estado
GET /v1/chats/{chat_id}/status
POST /v1/chats/{chat_id}/stop`;
    assert.ok(looksLikeApiEndpointCatalog(msg));
    assert.equal(looksLikeDbgaDocumentBody(msg), false);
    assert.ok(looksLikeDbgaEditRequest(msg));
  });
});

describe("looksLikeDbgaEditRequest", () => {
  it("detecta edición explícita al documento", () => {
    assert.ok(
      looksLikeDbgaEditRequest(
        "Haz las modificaciones al documento. Integrar Kill Switch y tablero de aprobación humana.",
      ),
    );
  });

  it("detecta «Haz los cambios al documento» (imperativo común)", () => {
    assert.ok(looksLikeDbgaEditRequest("Haz los cambios al documento"));
  });

  it("detecta «PAT de Wasender (llámalo ya así)» + Haz los cambios", () => {
    const msg =
      "tenemos un error en el uso de PAT con wasender , el PAT de Wasender (llámalo ya así) es de la cuenta principal, " +
      "para asociar un teléfono y poder crear sesión, se necesita tener el PAT configurado y luego el admin lee un QR. " +
      "Haz los cambios al documento";
    assert.ok(looksLikeDbgaEditRequest(msg));
  });

  it("detecta renombre PAT Wasender / PAT SSO + aplicar cambios", () => {
    const msg =
      "existen 2 PAT , uno es el de wasender api que es el de la cuenta que coordinará las sesiones de los teléfonos de los tenant y el otro es el PAT del sso para el usuario. Sugiero llamarlos PAT Wasender y PAT SSO para evitar confusiones\n\nHaz los cambios al documento";
    assert.ok(looksLikeDbgaEditRequest(msg));
  });

  it("detecta tenant con verbo de cambio", () => {
    assert.ok(
      looksLikeDbgaEditRequest(
        "Hay que hacer modificaciones. El catálogo debe ser multi tenant con tenant_id en OBP y OBP4MO",
      ),
    );
  });

  it("no trata brainstorming de arquitectura como edición DBGA", () => {
    assert.equal(
      looksLikeDbgaEditRequest(
        "Tenemos que aislar el núcleo del negocio de la infraestructura de las APIs. Vamos a usar adaptadores. Tendríamos que definir si cada agente tiene su propio modelo o cada tarea tiene un modelo.",
      ),
      false,
    );
  });

  it("no trata pregunta condicional con «en el DBGA» como edición inmediata", () => {
    const msg =
      "Hay un gap crítico: Migración de datos entre tiers. ¿Qué sugieres hacer? " +
      "¿Te parece bien esta aproximación? Si es así, la integro en el DBGA y la saco de omisiones críticas.";
    assert.ok(isUserExploringDbgaIntent(msg));
    assert.equal(looksLikeDbgaEditRequest(msg), false);
  });

  it("trata aclaración plugin vs motor de licencias como exploración", () => {
    const msg =
      "Esos límites los impone el plugin o son límites que impone nuestro motor de licencias y tenemos el mecanismo para controlar eso";
    assert.ok(isUserExploringDbgaIntent(msg));
    assert.equal(looksLikeDbgaEditRequest(msg), false);
  });

  it("sigue detectando cubrir gap como edición explícita", () => {
    assert.ok(
      looksLikeDbgaEditRequest(
        "Cubre el gap de Auditoría de acciones de cliente en Seguridad y elimínalo de omisiones críticas.",
      ),
    );
  });

  it("detecta revisión de gaps / motor agnóstico como edición DBGA", () => {
    assert.ok(
      looksLikeDbgaEditRequest(
        "evd es un plugin de ejemplo, lo importante es el motor de licenciamiento, revisa que no tenga gaps y que sea un motor de licenciamiento agnóstico",
      ),
    );
  });

  it("detecta integración de spec pegada (Portal de Licencias)", () => {
    const spec =
      "# Especificación del Portal de Licencias\n\n**Versión:** 1.0.0\n\n---\n\n## 1. Visión General\n\n" +
      "El Portal de Licencias valida licencias comerciales.\n\n## 2. Base URL\n\nPOST /licenses/validate\n\n".repeat(
        12,
      );
    const message =
      "lo ideal es que nuestro portal, en licenciamiento, pudiera complir con estas especificaciones\n\n" +
      spec;
    assert.ok(hasEmbeddedSpecificationBlock(message));
    assert.ok(looksLikeDbgaSpecIntegrationRequest(message));
    assert.ok(looksLikeDbgaEditRequest(message));
  });
});

describe("looksLikeDbgaDocumentBody", () => {
  it("detecta outline numerado de DBGA en el chat", () => {
    const body =
      "1. Resumen Ejecutivo\n\nForgeOps es una plataforma SaaS.\n\n2. Benchmark de Industria\n\nComparativa.\n\n".repeat(
        20,
      );
    assert.ok(looksLikeDbgaDocumentBody(body));
  });
});

describe("isHypotheticalDocumentEditOffer", () => {
  it("detecta pregunta de incorporar al DBGA", () => {
    assert.ok(
      isHypotheticalDocumentEditOffer(
        "¿Prefieres que profundice en esta arquitectura y la incorpore al DBGA como una sección de Capa de Abstracción?",
      ),
    );
  });

  it("detecta «¿Te parece correcto?» + actualizaré el DBGA", () => {
    assert.ok(
      isHypotheticalDocumentEditOffer(
        "¿Te parece correcto este enfoque? Si es así, actualizaré el DBGA para dejar explícito que el motor gestiona cuotas.",
      ),
    );
  });

  it("no confunde afirmación de cambio aplicado", () => {
    assert.equal(
      isHypotheticalDocumentEditOffer(
        "He actualizado el documento completo integrando la sección de adaptadores en el DBGA.",
      ),
      false,
    );
  });
});

describe("looksLikeProjectFactStatement", () => {
  it("detecta un dato con dominio («se encuentra en sso.obp.mx»)", () => {
    assert.ok(looksLikeProjectFactStatement("el sso corporativo se encuentra en sso.obp.mx"));
  });

  it("detecta un dato con verbo de uso o nombrado", () => {
    assert.ok(looksLikeProjectFactStatement("usamos Keycloak como proveedor de identidad"));
    assert.ok(looksLikeProjectFactStatement("el módulo de cobros se llama Caja Central"));
    assert.ok(looksLikeProjectFactStatement("el dominio es app.acme.mx"));
  });

  it("no toma preguntas ni condicionales como hechos", () => {
    assert.equal(looksLikeProjectFactStatement("¿el sso corporativo está en sso.obp.mx?"), false);
    assert.equal(
      looksLikeProjectFactStatement("creo que el sso corporativo está en sso.obp.mx"),
      false,
    );
    assert.equal(
      looksLikeProjectFactStatement("tal vez deberíamos usar Keycloak como proveedor"),
      false,
    );
  });

  it("ignora charla sin dato del proyecto ni mensajes largos", () => {
    assert.equal(looksLikeProjectFactStatement("gracias, me parece bien así"), false);
    assert.equal(looksLikeProjectFactStatement("ok"), false);
    assert.equal(
      looksLikeProjectFactStatement(`${"el sso corporativo se encuentra en sso.obp.mx y ".repeat(12)}fin`),
      false,
    );
  });
});
