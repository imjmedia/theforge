import { FalkorDB, Graph } from "falkordb";
import { MddStructured } from "../state/mdd-structured.schema.js";
import { validateSddReadQuery } from "./sdd-query-guard.js";
import {
    extractForeignKeyTargetsByTable,
    extractTableRefsFromSql,
    inferConsumedTableStorageNames,
} from "./sdd-consumes-link.util.js";
import { BadRequestException, Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { AIFactory } from "../../ai/ai.factory.js";
import { getRequestUserId } from "../../../common/request-user.store.js";
@Injectable()
export class GraphMemoryService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(GraphMemoryService.name);
    private client: FalkorDB | null = null;
    private graph: Graph | null = null;
    /** FalkorDB disabled — memory graph decommissioned. */
    /** Dimensiones para las que ya se creó índice vectorial en Falkor. */
    private readonly vectorIndexDims = new Set<number>();

    constructor(private readonly aiFactory: AIFactory) { }

    isConnected(): boolean {
        return this.graph != null;
    }

    private async embed(text: string, userId?: string): Promise<number[]> {
        const uid = userId ?? getRequestUserId();
        const runtime = await this.aiFactory.resolveEmbeddingRuntime(uid);
        if (!runtime.embeddingDimension) {
            throw new BadRequestException(
                "No se pudo determinar la dimensión de embeddings. Configura embeddingDimension o un modelo con dimensión conocida en el catálogo.",
            );
        }
        await this.ensureVectorIndices(runtime.embeddingDimension);
        const provider = await this.aiFactory.createEmbeddingForUser(uid);
        const vec = await provider.generateEmbedding(text);
        if (vec.length > 0 && vec.length !== runtime.embeddingDimension) {
            this.logger.warn(
                `[GraphMemory] dimensión devuelta (${vec.length}) ≠ configurada (${runtime.embeddingDimension}) para usuario ${uid}`,
            );
        }
        return vec;
    }

    async onModuleInit() {
        this.logger.log("[GraphMemoryService] Disabled — no longer connected to FalkorDB");
    }

    private async ensureVectorIndices(dim: number) {
        if (!this.graph || dim <= 0) return;
        if (this.vectorIndexDims.has(dim)) return;

        try {
            for (const label of ["Project", "Decision"] as const) {
                try {
                    await this.graph.query(
                        `CALL db.idx.vector.create('${label}', 'embedding', $dim, 'cosine')`,
                        { params: { dim } },
                    );
                    this.logger.log(`Índice vectorial creado para '${label}' con dimensión ${dim}`);
                } catch {
                    // Probablemente ya existe para esta dimensión
                }
            }
            this.vectorIndexDims.add(dim);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`No se pudieron inicializar índices vectoriales (dim=${dim}): ${msg}`);
        }
    }

    async onModuleDestroy() {
        if (this.client) {
            try {
                await this.client.close();
            } catch (err) {
                this.logger.error(`Error cerrando FalkorDB: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /**
     * Registra un proyecto en el grafo con su embedding.
     */
    async ensureProject(projectId: string, title?: string) {
        if (!this.graph) return;
        const textToEmbed = title || projectId;
        const embedding = await this.embed(textToEmbed);
        if (embedding.length === 0) return;

        const query = `
      MERGE (p:Project {id: $id}) 
      SET p.title = $title, p.embedding = $embedding 
      RETURN p
    `;
        await this.graph.query(query, { params: { id: projectId, title: textToEmbed, embedding } });
    }

    /**
     * Reconstruye el subgrafo SDD de una etapa: Stage, MDD_Section, DB_Entity, API_Endpoint, CONSUMES, IMPLEMENTS.
     */
    async syncMddToGraph(
        projectId: string,
        stageId: string | undefined,
        structured: MddStructured,
        opts?: { mddFingerprint?: string },
    ) {
        if (!this.graph) return;
        const sid = (stageId ?? "").trim();
        if (!sid) {
            this.logger.warn(`[GraphMemory] syncMddToGraph sin stageId para proyecto ${projectId}, skip`);
            return;
        }
        this.logger.log(`[GraphMemory] Sincronizando MDD para proyecto ${projectId} stage ${sid}`);

        try {
            await this.clearStageSddSlice(projectId, sid);

            const contextSummary = structured.contextoAlcance || "";
            const textToEmbed = `${structured.title || projectId}\n${contextSummary}`.slice(0, 2000);
            const embedding = await this.embed(textToEmbed);

            if (embedding.length > 0) {
                await this.graph.query(
                    `
        MERGE (p:Project {id: $id})
        SET p.title = $title, p.embedding = $embedding
        RETURN p
      `,
                    { params: { id: projectId, title: structured.title || projectId, embedding } },
                );
            } else {
                await this.graph.query(
                    `MERGE (p:Project {id: $id}) SET p.title = $title RETURN p`,
                    { params: { id: projectId, title: structured.title || projectId } },
                );
            }

            await this.graph.query(
                `
        MERGE (st:Stage {id: $stageId})
        SET st.projectId = $projectId,
            st.updatedAt = $ts,
            st.sddLastSyncedAt = $ts,
            st.sddMddFingerprint = $fp
        WITH st
        MATCH (p:Project {id: $projectId})
        MERGE (p)-[:HAS_STAGE]->(st)
        RETURN st
      `,
                {
                    params: {
                        stageId: sid,
                        projectId,
                        ts: Date.now(),
                        fp: opts?.mddFingerprint ?? "",
                    },
                },
            );

            const tableRefs = structured.modeloDatos?.sql
                ? extractTableRefsFromSql(structured.modeloDatos.sql)
                : [];
            const fkByTable = structured.modeloDatos?.sql
                ? extractForeignKeyTargetsByTable(structured.modeloDatos.sql)
                : new Map<string, Set<string>>();

            for (const ref of tableRefs) {
                await this.graph.query(
                    `
            MERGE (t:DB_Entity {name: $tableName, projectId: $projectId, stageId: $stageId})
            SET t.label = $tableName
            WITH t
            MATCH (st:Stage {id: $stageId})
            MERGE (st)-[:OWNS_ENTITY]->(t)
            RETURN t
          `,
                    { params: { tableName: ref.storageName, projectId, stageId: sid } },
                );
            }

            if (structured.contratosApi?.endpoints) {
                for (const ep of structured.contratosApi.endpoints) {
                    const endpointName = `${ep.method} ${ep.path}`;
                    const eid = `${sid}:${endpointName}`;
                    await this.graph.query(
                        `
            MERGE (e:API_Endpoint {id: $id})
            SET e.projectId = $projectId, e.stageId = $stageId, e.method = $method, e.path = $path, e.description = $desc
            WITH e
            MATCH (st:Stage {id: $stageId})
            MERGE (st)-[:OWNS_ENDPOINT]->(e)
            RETURN e
          `,
                        {
                            params: {
                                id: eid,
                                method: ep.method,
                                path: ep.path,
                                desc: ep.description || "",
                                projectId,
                                stageId: sid,
                            },
                        },
                    );
                    const consumed = inferConsumedTableStorageNames(ep.path ?? "", tableRefs, fkByTable);
                    for (const tbl of consumed) {
                        await this.graph.query(
                            `
              MATCH (e:API_Endpoint {id: $eid})
              MATCH (t:DB_Entity {name: $tbl, projectId: $projectId, stageId: $stageId})
              MERGE (e)-[:CONSUMES]->(t)
            `,
                            { params: { eid, tbl, projectId, stageId: sid } },
                        );
                    }
                }
            }

            if (structured.seguridad) {
                for (const s of structured.seguridad) {
                    await this.graph.query(
                        `
            MERGE (r:SecurityRule {title: $title, projectId: $projectId, stageId: $stageId})
            SET r.content = $content
            WITH r
            MATCH (st:Stage {id: $stageId})
            MERGE (st)-[:GOVERNED_BY]->(r)
            RETURN r
          `,
                        {
                            params: {
                                title: s.title,
                                content: s.content.join("\n"),
                                projectId,
                                stageId: sid,
                            },
                        },
                    );
                }
            }
            await this.syncMddSectionNodes(projectId, sid, structured);
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            this.logger.error(`Error sincronizando MDD al grafo: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Elimina artefactos SDD previos de la etapa (reconstrucción total por ingest). */
    private async clearStageSddSlice(projectId: string, stageId: string) {
        if (!this.graph) return;
        const q = `
      MATCH (n)
      WHERE n.projectId = $projectId AND n.stageId = $stageId
        AND (n:DB_Entity OR n:API_Endpoint OR n:MDD_Section OR n:SecurityRule)
      DETACH DELETE n
    `;
        await this.graph.query(q, { params: { projectId, stageId } });
    }

    /**
     * Nodos canónicos MDD_Section bajo Stage; IMPLEMENTS conecta la etapa con cada sección.
     */
    private async syncMddSectionNodes(projectId: string, stageId: string, structured: MddStructured) {
        if (!this.graph) return;
        const slices: Array<{ sectionKey: string; title: string; summary: string }> = [];
        if (structured.contextoAlcance?.trim()) {
            slices.push({ sectionKey: "1", title: "1. Contexto", summary: structured.contextoAlcance.trim().slice(0, 4000) });
        }
        if (structured.arquitecturaStack?.trim()) {
            slices.push({ sectionKey: "2", title: "2. Arquitectura y Stack", summary: structured.arquitecturaStack.trim().slice(0, 4000) });
        }
        if (structured.modeloDatos?.sql) {
            slices.push({
                sectionKey: "3",
                title: "3. Modelo de Datos",
                summary: (structured.modeloDatos.sql + "\n" + (structured.modeloDatos.diagramaEr ?? "")).slice(0, 4000),
            });
        }
        if (structured.contratosApi?.endpoints?.length) {
            const epSummary = structured.contratosApi.endpoints.map((e) => `${e.method} ${e.path}`).join("\n");
            slices.push({ sectionKey: "4", title: "4. Contratos de API", summary: epSummary.slice(0, 4000) });
        }
        if (structured.logicaEdgeCases?.trim()) {
            slices.push({ sectionKey: "5", title: "5. Lógica y Edge Cases", summary: structured.logicaEdgeCases.trim().slice(0, 4000) });
        }
        if (structured.seguridad?.length) {
            slices.push({
                sectionKey: "6",
                title: "6. Seguridad",
                summary: structured.seguridad.map((s) => s.title + ": " + s.content.join(" ")).join("\n").slice(0, 4000),
            });
        }
        if (structured.integracion) {
            slices.push({ sectionKey: "7", title: "7. Infraestructura", summary: JSON.stringify(structured.integracion).slice(0, 4000) });
        }
        for (const s of slices) {
            const q = `
        MERGE (sec:MDD_Section {projectId: $projectId, stageId: $stageId, sectionKey: $sectionKey})
        SET sec.title = $title, sec.summary = $summary, sec.updatedAt = $ts
        WITH sec
        MATCH (st:Stage {id: $stageId})
        MERGE (st)-[:IMPLEMENTS]->(sec)
        RETURN sec
      `;
            await this.graph.query(q, {
                params: {
                    projectId,
                    stageId,
                    sectionKey: s.sectionKey,
                    title: s.title,
                    summary: s.summary,
                    ts: Date.now(),
                },
            });
        }
    }

    /**
     * Lee entidades y endpoints SDD ingeridos para una etapa (cruce con índice Ariadne en flujo legacy).
     */
    async getSddStageSnapshot(
        projectId: string,
        stageId: string,
    ): Promise<{ entityNames: string[]; endpoints: Array<{ method: string; path: string }> } | null> {
        if (!this.graph) return null;
        const sid = (stageId ?? "").trim();
        const pid = (projectId ?? "").trim();
        if (!sid || !pid) return null;
        try {
            const qEntities = `
        MATCH (t:DB_Entity)
        WHERE t.projectId = $projectId AND t.stageId = $stageId
        RETURN collect(DISTINCT t.name) AS entityNames
      `;
            const qEndpoints = `
        MATCH (e:API_Endpoint)
        WHERE e.projectId = $projectId AND e.stageId = $stageId
        RETURN collect(DISTINCT { method: e.method, path: e.path }) AS endpoints
      `;
            const [r1, r2] = await Promise.all([
                this.graph.query(qEntities, { params: { projectId: pid, stageId: sid } }),
                this.graph.query(qEndpoints, { params: { projectId: pid, stageId: sid } }),
            ]);
            const rawNames = (r1?.data?.[0] as { entityNames?: unknown } | undefined)?.entityNames;
            const entityNames = Array.isArray(rawNames)
                ? rawNames.filter((x): x is string => typeof x === "string" && x.length > 0)
                : [];
            const rawEps = (r2?.data?.[0] as { endpoints?: unknown } | undefined)?.endpoints;
            const endpoints: Array<{ method: string; path: string }> = [];
            if (Array.isArray(rawEps)) {
                for (const row of rawEps) {
                    if (row && typeof row === "object" && "path" in row) {
                        const path = String((row as { path?: unknown }).path ?? "");
                        const method = String((row as { method?: unknown }).method ?? "");
                        if (path.trim()) endpoints.push({ method, path });
                    }
                }
            }
            return { entityNames, endpoints };
        } catch (err) {
            this.logger.warn(
                `[GraphMemory] getSddStageSnapshot falló: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }

    /**
     * Ingiere líneas-objetivo del BRD como nodos `BusinessObjective` (idempotente por etapa).
     */
    async ingestBrdObjectivesFromMarkdown(projectId: string, stageId: string, brdMarkdown: string): Promise<void> {
        if (!this.graph) return;
        const pid = (projectId ?? "").trim();
        const sid = (stageId ?? "").trim();
        if (!pid || !sid) return;
        const md = (brdMarkdown ?? "").trim();
        if (md.length < 20) return;

        const lines = md.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        const titles: string[] = [];
        for (const line of lines) {
            const bullet = line.match(/^[-*]\s+(.+)$/);
            if (bullet && bullet[1]!.trim().length > 5) {
                titles.push(bullet[1]!.trim().slice(0, 480));
            }
            if (titles.length >= 24) break;
        }
        if (titles.length === 0) {
            for (const line of lines) {
                if (/^#+\s/.test(line)) continue;
                if (line.length > 20) titles.push(line.slice(0, 480));
                if (titles.length >= 12) break;
            }
        }
        if (titles.length === 0) return;

        const params = { projectId: pid, stageId: sid };
        try {
            await this.graph.query(
                `MATCH (o:BusinessObjective) WHERE o.projectId = $projectId AND o.stageId = $stageId DELETE o`,
                { params },
            );
            for (let i = 0; i < titles.length; i++) {
                const title = titles[i]!;
                const key = `bo_${i}_${title.slice(0, 40).replace(/\W+/g, "_")}`;
                await this.graph.query(
                    `CREATE (:BusinessObjective {projectId: $projectId, stageId: $stageId, title: $title, objectiveKey: $key})`,
                    { params: { ...params, title, key } },
                );
            }
            this.logger.log(`[GraphMemory] BusinessObjective ingestados: ${titles.length} (project=${pid} stage=${sid})`);
        } catch (err) {
            this.logger.warn(
                `[GraphMemory] ingestBrdObjectivesFromMarkdown: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Evalúa coherencia de dependencias modelo↔API en el subgrafo SDD (FalkorDB / OpenCypher).
     */
    async evaluateSddDependencyHealth(
        projectId: string,
        stageId: string,
    ): Promise<{
        entityCount: number;
        endpointCount: number;
        orphanEntityCount: number;
        orphanEndpointCount: number;
        businessObjectiveCount: number;
        isCoherent: boolean;
    } | null> {
        if (!this.graph) return null;
        const pid = (projectId ?? "").trim();
        const sid = (stageId ?? "").trim();
        if (!pid || !sid) return null;
        const params = { projectId: pid, stageId: sid };

        const pickCount = (row: unknown, key: string): number => {
            if (!row || typeof row !== "object") return 0;
            const v = (row as Record<string, unknown>)[key];
            return typeof v === "number" && Number.isFinite(v) ? v : 0;
        };

        try {
            const qEntityTotal = `
        MATCH (t:DB_Entity)
        WHERE t.projectId = $projectId AND t.stageId = $stageId
        RETURN count(t) AS c
      `;
            const qEndpointTotal = `
        MATCH (e:API_Endpoint)
        WHERE e.projectId = $projectId AND e.stageId = $stageId
        RETURN count(e) AS c
      `;
            const qOrphanEndpoints = `
        MATCH (e:API_Endpoint)
        WHERE e.projectId = $projectId AND e.stageId = $stageId
          AND NOT (e)-[:CONSUMES]->(:DB_Entity)
        RETURN count(e) AS c
      `;
            const qOrphanEntities = `
        MATCH (t:DB_Entity)
        WHERE t.projectId = $projectId AND t.stageId = $stageId
          AND NOT (:API_Endpoint)-[:CONSUMES]->(t)
        RETURN count(t) AS c
      `;
            const qBusinessObjectives = `
        MATCH (o:BusinessObjective)
        WHERE o.projectId = $projectId AND o.stageId = $stageId
        RETURN count(o) AS c
      `;
            const [rEnt, rEp, rOe, rOt, rBo] = await Promise.all([
                this.graph.query(qEntityTotal, { params }),
                this.graph.query(qEndpointTotal, { params }),
                this.graph.query(qOrphanEndpoints, { params }),
                this.graph.query(qOrphanEntities, { params }),
                this.graph.query(qBusinessObjectives, { params }),
            ]);

            const entityCount = pickCount(rEnt?.data?.[0], "c");
            const endpointCount = pickCount(rEp?.data?.[0], "c");
            const orphanEndpointCount = pickCount(rOe?.data?.[0], "c");
            const orphanEntityCount = pickCount(rOt?.data?.[0], "c");
            const businessObjectiveCount = pickCount(rBo?.data?.[0], "c");

            let isCoherent =
                entityCount > 0 &&
                endpointCount > 0 &&
                orphanEndpointCount === 0 &&
                orphanEntityCount === 0;
            if (businessObjectiveCount > 0 && entityCount === 0) {
                isCoherent = false;
            }

            return {
                entityCount,
                endpointCount,
                orphanEntityCount,
                orphanEndpointCount,
                businessObjectiveCount,
                isCoherent,
            };
        } catch (err) {
            this.logger.warn(
                `[GraphMemory] evaluateSddDependencyHealth falló: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }

    /**
     * Cypher de solo lectura sobre el grafo SDD (Agentic RAG).
     */
    async querySddGraphReadOnly(cypher: string, params?: Record<string, unknown>) {
        const trimmed = (cypher ?? "").trim();
        if (!trimmed) return { data: [] as unknown[] };
        validateSddReadQuery(trimmed, params);
        return this.queryKnowledge(trimmed, params as Record<string, unknown> | undefined);
    }

    /**
     * Búsqueda híbrida (GraphRAG):
     * 1. Vector Search para encontrar proyectos similares.
     * 2. Traversal para recuperar sus tablas y contratos.
     */
    async searchSimilarProjects(query: string, limit = 3) {
        if (!this.graph) return [];
        try {
            const embedding = await this.embed(query);
            if (embedding.length === 0) return [];

            const cypher = `
        CALL db.idx.vector.queryNodes('Project', 'embedding', $limit, $embedding)
        YIELD node AS project, score
        OPTIONAL MATCH (project)-[:HAS_STAGE]->(:Stage)-[:OWNS_ENTITY]->(t:DB_Entity)
        OPTIONAL MATCH (project)-[:HAS_STAGE]->(:Stage)-[:OWNS_ENDPOINT]->(e:API_Endpoint)
        RETURN project.id as id, project.title as title, score,
               collect(distinct t.name) as tables,
               collect(distinct e.path) as endpoints
        ORDER BY score DESC
      `;
            const result = await this.graph.query(cypher, { params: { embedding, limit } });
            return result.data;
        } catch (err) {
            if (err instanceof BadRequestException) {
                this.logger.warn(`[GraphMemory] searchSimilarProjects: ${err.message}`);
                return [];
            }
            this.logger.error(`Error en búsqueda similar: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }

    /**
     * Búsqueda híbrida (GraphRAG): busca por patrones en el grafo.
     */
    async queryKnowledge(cypher: string, params?: Record<string, any>) {
        if (!this.graph) return null;
        return await this.graph.query(cypher, { params });
    }

    /**
     * Registra una decisión arquitectónica (ADR) en el grafo.
     */
    async saveDecision(projectId: string, decision: { title: string, context: string, consequence: string, status?: string }) {
        if (!this.graph) return;
        this.logger.log(`[GraphMemory] Guardando decisión ADR: ${decision.title}`);

        try {
            const textToEmbed = `${decision.title}\n${decision.context}\n${decision.consequence}`.slice(0, 2000);
            const embedding = await this.embed(textToEmbed);
            if (embedding.length === 0) return;

            const query = `
        MATCH (p:Project {id: $projectId})
        MERGE (d:Decision {id: $id, projectId: $projectId})
        SET d.title = $title, 
            d.context = $context, 
            d.consequence = $consequence, 
            d.status = $status,
            d.embedding = $embedding
        MERGE (p)-[:MADE_DECISION]->(d)
        RETURN d
      `;
            await this.graph.query(query, {
                params: {
                    id: `${projectId}:${decision.title.replace(/\s+/g, "_").toLowerCase()}`,
                    projectId,
                    title: decision.title,
                    context: decision.context,
                    consequence: decision.consequence,
                    status: decision.status || "Accepted",
                    embedding
                }
            });
        } catch (err) {
            if (err instanceof BadRequestException) {
                this.logger.warn(`[GraphMemory] saveDecision: ${err.message}`);
                return;
            }
            this.logger.error(`Error guardando decisión ADR: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Búsqueda híbrida de decisiones pasadas.
     */
    async searchSimilarDecisions(query: string, limit = 5) {
        if (!this.graph) return [];
        try {
            const embedding = await this.embed(query);
            if (embedding.length === 0) return [];

            const cypher = `
        CALL db.idx.vector.queryNodes('Decision', 'embedding', $limit, $embedding)
        YIELD node AS decision, score
        MATCH (p:Project)-[:MADE_DECISION]->(decision)
        RETURN decision.title as title, 
               decision.context as context, 
               decision.consequence as consequence,
               decision.status as status,
               p.title as projectTitle,
               score
        ORDER BY score DESC
      `;
            const result = await this.graph.query(cypher, { params: { embedding, limit } });
            return result.data;
        } catch (err) {
            if (err instanceof BadRequestException) {
                this.logger.warn(`[GraphMemory] searchSimilarDecisions: ${err.message}`);
                return [];
            }
            this.logger.error(`Error en búsqueda de decisiones: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }

    /**
     * Obtiene todas las decisiones (ADRs) asociadas a un proyecto específico.
     */
    async getDecisionsByProject(projectId: string) {
        if (!this.graph) return [];
        try {
            const cypher = `
                MATCH (p:Project {id: $projectId})-[:MADE_DECISION]->(d:Decision)
                RETURN d.title as title, 
                       d.context as context, 
                       d.consequence as consequence,
                       d.status as status,
                       p.title as projectTitle
                ORDER BY d.title ASC
            `;
            const result = await this.graph.query(cypher, { params: { projectId } });
            return result.data;
        } catch (err) {
            this.logger.error(`Error obteniendo decisiones del proyecto ${projectId}: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }

    /**
     * Crea/actualiza un nodo :LegacyStage en FalkorDB con sus relaciones.
     */
    async syncLegacyStage(params: {
        stageId: string;
        projectId: string;
        ordinal: number;
        name: string;
        description?: string;
        parentStageId?: string;
        theforgeProjectId?: string;
    }) {
        if (!this.graph) return;
        const { stageId, projectId, ordinal, name, description, parentStageId, theforgeProjectId } = params;
        const ts = Date.now();

        try {
            await this.graph.query(
                `
          MERGE (s:LegacyStage {stageId: $stageId})
          SET s.projectId = $projectId,
              s.ordinal = $ordinal,
              s.name = $name,
              s.description = $description,
              s.updatedAt = $ts
          RETURN s
        `,
                {
                    params: {
                        stageId,
                        projectId,
                        ordinal,
                        name,
                        description: description ?? '',
                        ts,
                    },
                },
            );

            if (parentStageId) {
                await this.graph.query(
                    `
            MATCH (s:LegacyStage {stageId: $stageId})
            MATCH (parent:LegacyStage {stageId: $parentStageId})
            MERGE (s)-[:DERIVED_FROM]->(parent)
          `,
                    { params: { stageId, parentStageId } },
                );
            }

            if (theforgeProjectId) {
                await this.graph.query(
                    `
            MATCH (s:LegacyStage {stageId: $stageId})
            MERGE (p:Project {id: $theforgeProjectId})
            MERGE (p)-[:HAS_LEGACY_STAGE]->(s)
          `,
                    { params: { stageId, theforgeProjectId } },
                );
            }

            this.logger.log(`[GraphMemory] LegacyStage sincronizado: ${name} (${stageId})`);
        } catch (err) {
            this.logger.error(`[GraphMemory] syncLegacyStage falló: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Elimina un nodo LegacyStage y sus relaciones del grafo FalkorDB.
     */
    async clearLegacyStage(stageId: string) {
        if (!this.graph) return;
        try {
            await this.graph.query(
                `
          MATCH (s:LegacyStage {stageId: $stageId})
          DETACH DELETE s
        `,
                { params: { stageId } },
            );
            this.logger.log(`[GraphMemory] LegacyStage eliminado: ${stageId}`);
        } catch (err) {
            this.logger.error(`[GraphMemory] clearLegacyStage falló: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Enlace cross-project NEW ↔ LEGACY en grafo SDD local.
     */
    async syncProjectIntegrationLink(newProjectId: string, legacyProjectId: string) {
        if (!this.graph) return;
        const ts = Date.now();
        try {
            await this.graph.query(
                `
          MERGE (n:ForgeProject {id: $newProjectId})
          SET n.kind = 'NEW', n.updatedAt = $ts
          MERGE (l:ForgeProject {id: $legacyProjectId})
          SET l.kind = 'LEGACY', l.updatedAt = $ts
          MERGE (n)-[:INTEGRATES_WITH]->(l)
        `,
                { params: { newProjectId, legacyProjectId, ts } },
            );
            this.logger.log(`[GraphMemory] INTEGRATES_WITH ${newProjectId} → ${legacyProjectId}`);
        } catch (err) {
            this.logger.error(
                `[GraphMemory] syncProjectIntegrationLink falló: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Trazabilidad handoff NEW-LEG satisfecho por LEG-XX.
     */
    async syncHandoffSatisfies(
        newProjectId: string,
        legacyProjectId: string,
        newLegId: string,
        legacyStoryId: string,
    ) {
        if (!this.graph) return;
        const ts = Date.now();
        try {
            await this.graph.query(
                `
          MERGE (h:HandoffItem {id: $newLegId, newProjectId: $newProjectId})
          SET h.updatedAt = $ts
          MERGE (s:UserStory {id: $legacyStoryId, projectId: $legacyProjectId})
          SET s.updatedAt = $ts
          MERGE (h)-[:SATISFIES]->(s)
        `,
                { params: { newProjectId, legacyProjectId, newLegId, legacyStoryId, ts } },
            );
        } catch (err) {
            this.logger.error(
                `[GraphMemory] syncHandoffSatisfies falló: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Post-promote/import: link HandoffItem nodes to LegacyStage and INTEGRATES_WITH project link.
     */
    async syncHandoffItemsToStage(params: {
        newProjectId: string;
        legacyProjectId: string;
        legacyStageId: string;
        items: Array<{ id: string; title?: string; description?: string }>;
    }) {
        if (!this.graph) return;
        const ts = Date.now();
        const { newProjectId, legacyProjectId, legacyStageId, items } = params;
        try {
            await this.syncProjectIntegrationLink(newProjectId, legacyProjectId);
            for (const item of items) {
                await this.graph.query(
                    `
              MERGE (h:HandoffItem {id: $newLegId, newProjectId: $newProjectId})
              SET h.title = $title, h.description = $description, h.legacyStageId = $legacyStageId, h.updatedAt = $ts
              MERGE (st:LegacyStage {stageId: $legacyStageId})
              SET st.updatedAt = $ts
              MERGE (h)-[:INTEGRATES_WITH]->(st)
            `,
                    {
                        params: {
                            newLegId: item.id,
                            newProjectId,
                            legacyStageId,
                            title: item.title ?? item.id,
                            description: (item.description ?? "").slice(0, 2000),
                            ts,
                        },
                    },
                );
            }
            this.logger.log(
                `[GraphMemory] syncHandoffItemsToStage stage=${legacyStageId} items=${items.length}`,
            );
        } catch (err) {
            this.logger.error(
                `[GraphMemory] syncHandoffItemsToStage falló: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
