import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mddRequiresEventBrokerContracts,
  resolveMessagingBrokerFromMddSection2,
} from "./messaging-broker.util.js";
import { checkEventContractsCoverage } from "./sdd-precision-checks.util.js";
import { collectExternalIntegrationContractGaps } from "./sdd-external-contracts.util.js";

describe("messaging-broker.util", () => {
  it("resolveMessagingBrokerFromMddSection2 detects BullMQ primario", () => {
    const mdd = `
## 2. Stack Tecnológico
Cola de trabajos: BullMQ + Redis como broker primario.
`;
    assert.equal(resolveMessagingBrokerFromMddSection2(mdd), "bull");
    assert.equal(mddRequiresEventBrokerContracts(mdd), false);
  });

  it("resolveMessagingBrokerFromMddSection2 detecta RabbitMQ explícito", () => {
    const mdd = `
## 2. Stack Tecnológico
Mensajería: RabbitMQ con patrón outbox.
`;
    assert.equal(resolveMessagingBrokerFromMddSection2(mdd), "rabbitmq");
    assert.equal(mddRequiresEventBrokerContracts(mdd), true);
  });
});

describe("checkEventContractsCoverage broker-aware", () => {
  const blueprintEda = "## Blueprint\nEvent-driven con outbox pattern y RabbitMQ opcional.\n";
  const mddBull = "## 2. Stack\nBullMQ + Redis para jobs async.\n";
  const mddRabbit = "## 2. Stack\nRabbitMQ como message broker.\n";

  it("no dispara cuando §2=BullMQ aunque blueprint mencione outbox/EDA", () => {
    const result = checkEventContractsCoverage(mddBull, blueprintEda, "", "");
    assert.equal(result.ok, true);
    assert.equal(result.gaps.length, 0);
  });

  it("dispara cuando §2=RabbitMQ y faltan tasks/logic-flows", () => {
    const result = checkEventContractsCoverage(mddRabbit, blueprintEda, "", "");
    assert.equal(result.ok, false);
    assert.ok(result.gaps.some((g) => /\[Events\]/i.test(g)));
  });
});

describe("collectExternalIntegrationContractGaps broker-aware", () => {
  it("no exige integración rabbitmq cuando §2=BullMQ aunque haya tabla outbox", () => {
    const mdd = `
## 2. Stack
BullMQ + Redis.
## 3. Modelo
CREATE TABLE outbox (id UUID PRIMARY KEY);
`;
    const gaps = collectExternalIntegrationContractGaps({
      mddMarkdown: mdd,
      dbgaMarkdown: "Event-driven con outbox pattern para jobs.",
      apiContractsMarkdown: "",
      architectureMarkdown: "",
      infraMarkdown: "",
    });
    assert.ok(!gaps.some((g) => /\[Integración rabbitmq\]/i.test(g)));
  });
});
