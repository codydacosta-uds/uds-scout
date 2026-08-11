import "server-only";

import type { ZarfPackage } from "@/components/security-types";
import { githubRequest } from "@/lib/github";
import { parseImageReference } from "@/lib/security-normalization";
import { discoverPublishedZarfSboms } from "@/lib/security-oci";
import { parseSbom, sbomAssociationText } from "@/lib/security-sbom";
import type { SecuritySbomDocument } from "@/lib/security-sbom-resolvers";

export interface PublishedZarfLocationResolver {
  locations(repository: string, packages: ZarfPackage[]): string[] | Promise<string[]>;
}

class UdsCorePublishedZarfResolver implements PublishedZarfLocationResolver {
  locations(repository: string, packages: ZarfPackage[]) {
    if (repository.toLowerCase() !== "defenseunicorns/uds-core") return [];
    const core = packages.find((item) => item.name === "core" && item.version);
    return core?.version ? [`ghcr.io/defenseunicorns/packages/uds/core:${core.version}-upstream`] : [];
  }
}

async function latestUdsPackageReleases(repository: string) {
  const [owner, name] = repository.toLowerCase().split("/");
  if (owner !== "uds-packages" || !name) return { name: null, tags: new Map<string, string>() };
  const releases = await githubRequest<Array<{ tag_name: string; draft: boolean }>>(`/repos/${owner}/${name}/releases?per_page=30`, 60 * 60 * 1000);
  const tags = new Map<string, string>();
  for (const release of releases) {
    if (release.draft || !/^[a-z0-9._+-]+$/i.test(release.tag_name)) continue;
    const flavor = release.tag_name.match(/-(upstream|registry1|unicorn)$/i)?.[1].toLowerCase();
    if (flavor && !tags.has(flavor)) tags.set(flavor, release.tag_name);
  }
  return { name, tags };
}

class UdsPackagesPublishedZarfResolver implements PublishedZarfLocationResolver {
  async locations(repository: string) {
    const { name, tags } = await latestUdsPackageReleases(repository);
    return name ? [...tags.values()].map((tag) => `ghcr.io/uds-packages/${name}:${tag}`) : [];
  }
}

class DefenseUnicornsPrivateZarfResolver implements PublishedZarfLocationResolver {
  async locations(repository: string) {
    const username = (process.env.UDS_SCOUT_DEFENSE_REGISTRY_USERNAME ?? process.env.UDS_SCOUT_CGR_USERNAME)?.trim();
    const password = process.env.UDS_SCOUT_DEFENSE_REGISTRY_PASSWORD ?? process.env.UDS_SCOUT_CGR_PASSWORD;
    if (!username || !password) return [];
    const { name, tags } = await latestUdsPackageReleases(repository);
    if (!name) return [];
    return ["registry1", "unicorn"].flatMap((flavor) => {
      const tag = tags.get(flavor);
      return tag ? [`registry.defenseunicorns.com/navy-sonic/${name}:${tag}`] : [];
    });
  }
}

const LOCATION_RESOLVERS: PublishedZarfLocationResolver[] = [new UdsCorePublishedZarfResolver(), new UdsPackagesPublishedZarfResolver(), new DefenseUnicornsPrivateZarfResolver()];

export async function discoverPublishedZarfPackageSboms(repository: string, packages: ZarfPackage[]): Promise<SecuritySbomDocument[]> {
  const resolvedLocations = await Promise.all(LOCATION_RESOLVERS.map((resolver) => resolver.locations(repository, packages)));
  const locations = [...new Set(resolvedLocations.flat())];
  const documents: SecuritySbomDocument[] = [];
  for (const location of locations) {
    try {
      const entries = await discoverPublishedZarfSboms(parseImageReference(location));
      for (const entry of entries) {
        if (!parseSbom(entry.document)) continue;
        documents.push({
          document: entry.document,
          text: `${entry.name.toLowerCase()} ${sbomAssociationText(entry.document)}`,
          source: `Published Zarf package (${location})`,
          artifactName: entry.name,
        });
      }
    } catch (error) {
      if (process.env.UDS_SCOUT_SECURITY_DEBUG === "true") console.warn(`Published Zarf SBOM lookup failed for ${location}.`, error);
      // Other SBOM resolvers remain available when a published package is private or absent.
    }
  }
  return documents;
}
