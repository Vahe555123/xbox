const config = require('../config');

const ATTRIBUTE_LABELS = {
  XblOnlineCoop: 'Online co-op',
  XblOnlineMultiPlayer: 'Online multiplayer',
  BroadcastSupport: 'Broadcasting',
  Capability4k: '4K Ultra HD',
  '120fps': '120 fps',
  ConsoleGen9Optimized: 'Optimized for Xbox Series X|S',
  ConsoleCrossGen: 'Smart Delivery',
  CapabilityXboxEnhanced: 'Xbox One X Enhanced',
  XPA: 'Xbox Play Anywhere',
  XboxLive: 'Xbox Live',
};

const PLATFORM_LABELS = {
  ConsoleGen8: 'Xbox One',
  ConsoleGen9: 'Xbox Series X|S',
  'Windows.Desktop': 'PC',
  PC: 'PC',
};

function absUri(uri) {
  if (!uri) return null;
  if (String(uri).startsWith('//')) return `https:${uri}`;
  return uri;
}

function formatMoney(value, currency) {
  if (value === null || value === undefined) return null;
  const c = currency || 'USD';
  if (value === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(value);
  } catch {
    return `$${Number(value).toFixed(2)}`;
  }
}

function mapImages(images) {
  if (!Array.isArray(images)) return [];
  return images.map((img) => ({
    purpose: img.ImagePurpose || null,
    uri: absUri(img.Uri),
    width: img.Width ?? null,
    height: img.Height ?? null,
    caption: img.Caption || null,
    backgroundColor: img.BackgroundColor || null,
    foregroundColor: img.ForegroundColor || null,
    fileSizeInBytes: img.FileSizeInBytes ?? null,
  }));
}

function mapVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.map((v) => ({
    title: v.Title || null,
    uri: absUri(v.Uri) || v.Uri || null,
    previewImage: v.PreviewImage?.Uri ? absUri(v.PreviewImage.Uri) : null,
    purpose: v.VideoPurpose || null,
    height: v.Height ?? null,
    width: v.Width ?? null,
  }));
}

function mapCmsVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.map((v) => ({
    caption: v.Caption || null,
    purpose: v.VideoPurpose || null,
    dashUrl: v.DASH || null,
    hlsUrl: v.HLS || null,
    height: v.Height ?? null,
    width: v.Width ?? null,
    previewImage: v.PreviewImage?.Uri ? absUri(v.PreviewImage.Uri) : null,
  }));
}

function mapAttributes(attrs) {
  if (!Array.isArray(attrs)) return [];
  return attrs.map((a) => {
    const label = ATTRIBUTE_LABELS[a.Name] || a.Name;
    let detail = null;
    if (a.Minimum != null && a.Maximum != null) {
      detail = `${a.Minimum}-${a.Maximum}`;
    } else if (a.Minimum != null) {
      detail = String(a.Minimum);
    }
    return {
      id: a.Name,
      label,
      detail,
      platforms: a.ApplicablePlatforms || null,
    };
  });
}

function mapPriceFromOrder(price) {
  if (!price) return null;
  const currency = price.CurrencyCode || price.currency || 'USD';
  const list = price.ListPrice ?? price.listPrice;
  const msrp = price.MSRP ?? price.msrp;
  return {
    listPrice: list,
    msrp,
    currency,
    formattedList: formatMoney(list, currency),
    formattedMsrp: msrp != null ? formatMoney(msrp, currency) : null,
    taxType: price.TaxType || null,
    isPIRequired: price.IsPIRequired ?? null,
  };
}

function pickPrimaryPrice(skus) {
  const candidates = (skus || [])
    .flatMap((sku) => (sku.availabilities || []).map((availability) => ({
      sku,
      availability,
      price: availability.price,
    })))
    .filter(({ sku }) => !isTrialSku(sku))
    .filter(({ availability, price }) => (
      price
      && price.listPrice != null
      && Array.isArray(availability.actions)
      && availability.actions.includes('Purchase')
    ));

  if (!candidates.length) return null;

  const paid = candidates.filter(({ price }) => Number(price.listPrice) > 0);
  const pool = paid.length ? paid : candidates;
  const best = pool.reduce((min, item) => (
    Number(item.price.listPrice) < Number(min.price.listPrice) ? item : min
  ), pool[0]).price;
  const hasDiscount = best.msrp != null && Number(best.listPrice) < Number(best.msrp);

  return {
    value: best.listPrice,
    currency: best.currency,
    formatted: best.formattedList,
    isFree: Number(best.listPrice) === 0,
    original: hasDiscount ? best.msrp : null,
    originalFormatted: hasDiscount ? best.formattedMsrp : null,
    msrp: best.msrp,
    formattedMsrp: best.formattedMsrp,
    status: 'available',
  };
}

function isTrialSku(sku) {
  return /trial/i.test([
    sku?.skuType,
    sku?.title,
    sku?.description,
    sku?.skuButtonTitle,
  ].filter(Boolean).join(' '));
}

/**
 * Store LegalText is either a plain string or an object (copyright, privacy, TOU, URIs).
 */
function mapSkuLegal(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length ? { type: 'text', text: t } : null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const documents = {
    type: 'documents',
    additionalLicenseTerms: raw.AdditionalLicenseTerms || null,
    copyright: raw.Copyright || null,
    copyrightUri: raw.CopyrightUri ? absUri(raw.CopyrightUri) : null,
    privacyPolicy: raw.PrivacyPolicy || null,
    privacyPolicyUri: raw.PrivacyPolicyUri ? absUri(raw.PrivacyPolicyUri) : null,
    tou: raw.Tou || null,
    touUri: raw.TouUri ? absUri(raw.TouUri) : null,
  };
  const has =
    documents.additionalLicenseTerms
    || documents.copyright
    || documents.copyrightUri
    || documents.privacyPolicy
    || documents.privacyPolicyUri
    || documents.tou
    || documents.touUri;
  return has ? documents : null;
}

function mapHardwareRequirements(skuProps, skuLp) {
  const hw = skuProps?.HardwareProperties || {};
  const notes = skuLp?.MinimumNotes;
  const recNotes = skuLp?.RecommendedNotes;

  // Build minimum requirements from structured HardwareProperties
  const minReqs = [];
  if (hw.MinimumProcessor) minReqs.push({ label: 'Processor', value: hw.MinimumProcessor });
  if (hw.MinimumGraphics) minReqs.push({ label: 'Graphics', value: hw.MinimumGraphics });
  if (Array.isArray(hw.MinimumHardware)) {
    hw.MinimumHardware.forEach((item) => {
      if (item.HardwareItemType && item.Minimum) {
        minReqs.push({ label: item.HardwareItemType, value: item.Minimum });
      }
    });
  }

  // Build recommended requirements
  const recReqs = [];
  if (hw.RecommendedProcessor) recReqs.push({ label: 'Processor', value: hw.RecommendedProcessor });
  if (hw.RecommendedGraphics) recReqs.push({ label: 'Graphics', value: hw.RecommendedGraphics });
  if (Array.isArray(hw.RecommendedHardware)) {
    hw.RecommendedHardware.forEach((item) => {
      if (item.HardwareItemType && item.Minimum) {
        recReqs.push({ label: item.HardwareItemType, value: item.Minimum });
      }
    });
  }

  // Parse architecture from HardwareRequirements array
  const hardwareReqs = skuProps?.HardwareRequirements || [];
  hardwareReqs.forEach((item) => {
    if (item.HardwareItemType === 'Architecture' && item.Minimum) {
      if (!minReqs.find((r) => r.label === 'Architecture')) {
        minReqs.push({ label: 'Architecture', value: item.Minimum });
        recReqs.push({ label: 'Architecture', value: item.Minimum });
      }
    }
  });

  const hasData = minReqs.length > 0 || recReqs.length > 0
    || (notes && notes.trim()) || (recNotes && recNotes.trim());

  if (!hasData) return null;

  return {
    minimum: minReqs,
    recommended: recReqs,
    minimumNotes: (notes && notes.trim()) || null,
    recommendedNotes: (recNotes && recNotes.trim()) || null,
    warningList: skuProps?.HardwareWarningList || [],
  };
}

function mapSkus(displaySkuAvailabilities) {
  if (!Array.isArray(displaySkuAvailabilities)) return [];

  return displaySkuAvailabilities.map((entry) => {
    const sku = entry.Sku || {};
    const skuLp = sku.LocalizedProperties?.[0] || {};
    const skuProps = sku.Properties || {};
    const availabilities = (entry.Availabilities || []).map((av) => ({
      availabilityId: av.AvailabilityId,
      skuId: av.SkuId,
      actions: av.Actions || [],
      displayRank: av.DisplayRank ?? null,
      price: mapPriceFromOrder(av.OrderManagementData?.Price),
      alternateIds: av.AlternateIds || [],
    }));

    return {
      skuId: sku.SkuId,
      skuType: sku.SkuType || null,
      title: skuLp.SkuTitle || null,
      description: typeof skuLp.SkuDescription === 'string' ? skuLp.SkuDescription : null,
      skuButtonTitle: typeof skuLp.SkuButtonTitle === 'string' ? skuLp.SkuButtonTitle : null,
      legal: mapSkuLegal(skuLp.LegalText),
      releaseNotes: skuLp.ReleaseNotes || null,
      minimumNotes: skuLp.MinimumNotes || null,
      recommendedNotes: skuLp.RecommendedNotes || null,
      features: skuLp.Features || [],
      contributors: skuLp.Contributors || [],
      images: mapImages(skuLp.Images),
      availabilities,
      hardwareRequirements: mapHardwareRequirements(skuProps, skuLp),
    };
  });
}

function mapContentRatings(ratings) {
  if (!Array.isArray(ratings)) return [];
  return ratings.map((r) => ({
    system: r.RatingSystem || null,
    ratingId: r.RatingId || null,
    descriptors: r.RatingDescriptors || [],
    disclaimers: r.RatingDisclaimers || [],
    interactiveElements: r.InteractiveElements || [],
  }));
}

function hasPendingRating(ratings) {
  return (ratings || []).some((rating) => /RP|RATING PENDING/i.test([
    rating.ratingId,
    ...(rating.descriptors || []),
    ...(rating.disclaimers || []),
  ].filter(Boolean).join(' ')));
}

function mapRelatedProducts(related) {
  if (!Array.isArray(related)) return [];
  return related.map((r) => ({
    productId: r.RelatedProductId,
    relationshipType: r.RelationshipType || null,
  }));
}

function mapUsageData(usage) {
  if (!Array.isArray(usage)) return [];
  return usage.map((u) => ({
    timeSpan: u.AggregateTimeSpan || null,
    averageRating: u.AverageRating ?? null,
    ratingCount: u.RatingCount ?? null,
    playCount: u.PlayCount ?? null,
  }));
}

function mapEligibility(lp) {
  const ep = lp?.EligibilityProperties;
  if (!ep) return { remediations: [], affirmations: [] };
  return {
    remediations: (ep.Remediations || []).map((x) => ({
      id: x.RemediationId,
      description: x.Description || null,
    })),
    affirmations: (ep.Affirmations || []).map((x) => ({
      id: x.AffirmationId,
      productId: x.AffirmationProductId || null,
      description: x.Description || null,
    })),
  };
}

function mapPlatforms(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => PLATFORM_LABELS[value] || value)
    .filter(Boolean);
}

function storeUrl(productId, title) {
  const slug = (title || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
  return `https://www.xbox.com/${config.xbox.locale}/games/store/${slug}/${productId}`;
}

function normalizeReleaseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year >= 9998 || year <= 1753) return null;
  return value;
}

function formatDateLabel(value) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildReleaseInfo({ releaseDate, price, contentRatings }) {
  if (releaseDate && new Date(releaseDate).getTime() > Date.now()) {
    return {
      status: 'comingSoon',
      label: `Coming ${formatDateLabel(releaseDate)}`,
      releaseDate,
    };
  }

  if (!releaseDate && !price && hasPendingRating(contentRatings)) {
    return {
      status: 'unreleased',
      label: 'Not released yet',
      releaseDate: null,
      note: 'Release date is not announced in the Xbox catalog yet.',
    };
  }

  return {
    status: releaseDate ? 'released' : 'unknown',
    label: releaseDate ? `Released ${formatDateLabel(releaseDate)}` : null,
    releaseDate,
  };
}

function mapProductDetail(raw) {
  const lp = raw.LocalizedProperties?.[0] || {};
  const mp = raw.MarketProperties?.[0] || {};
  const props = raw.Properties || {};

  const title = lp.ProductTitle || raw.ProductId;
  const productId = raw.ProductId;
  const skus = mapSkus(raw.DisplaySkuAvailabilities);
  const playWith = mapPlatforms(props.XboxConsoleGenCompatible);
  const price = pickPrimaryPrice(skus);
  const contentRatings = mapContentRatings(mp.ContentRatings);
  const releaseDate = normalizeReleaseDate(mp.OriginalReleaseDate);
  const releaseInfo = buildReleaseInfo({ releaseDate, price, contentRatings });

  return {
    id: productId,
    productKind: raw.ProductKind || null,
    productType: raw.ProductType || null,
    productFamily: raw.ProductFamily || null,
    isMicrosoftProduct: raw.IsMicrosoftProduct ?? null,
    sandboxId: raw.SandboxId || null,
    lastModifiedDate: raw.LastModifiedDate || null,

    title,
    shortTitle: lp.ShortTitle || null,
    sortTitle: lp.SortTitle || null,
    friendlyTitle: lp.FriendlyTitle || null,
    voiceTitle: lp.VoiceTitle || null,

    shortDescription: lp.ShortDescription || null,
    fullDescription: lp.ProductDescription || null,

    developerName: lp.DeveloperName || null,
    publisherName: lp.PublisherName || null,
    publisherAddress: lp.PublisherAddress || null,
    publisherWebsiteUri: absUri(lp.PublisherWebsiteUri),
    supportUri: absUri(lp.SupportUri),
    supportPhone: lp.SupportPhone || null,

    language: lp.Language || null,
    franchises: lp.Franchises || [],
    searchTitles: lp.SearchTitles || [],

    categories: props.Categories || [],
    category: props.Category || null,
    subcategory: props.Subcategory || null,

    images: mapImages(lp.Images),
    videos: mapVideos(lp.Videos),
    cmsVideos: mapCmsVideos(lp.CMSVideos),

    eligibility: mapEligibility(lp),

    contentRatings,
    originalReleaseDate: releaseDate,
    releaseInfo,
    minimumUserAge: mp.MinimumUserAge ?? null,

    usage: mapUsageData(mp.UsageData),
    relatedProducts: mapRelatedProducts(mp.RelatedProducts),

    price,
    playWith,
    supportedLanguage: lp.Language || null,

    xbox: {
      xpa: props.XboxXPA ?? null,
      liveGoldRequired: props.XboxLiveGoldRequired ?? null,
      liveTier: props.XboxLiveTier || null,
      consoleGenOptimized: props.XboxConsoleGenOptimized || null,
      consoleGenCompatible: props.XboxConsoleGenCompatible || null,
      crossGenSetId: props.XboxCrossGenSetId || null,
      submissionId: props.XBOX?.SubmissionId || null,
    },

    capabilities: mapAttributes(props.Attributes),

    packageFamilyName: props.PackageFamilyName || null,
    packageIdentityName: props.PackageIdentityName || null,
    hasAddOns: props.HasAddOns ?? null,
    isDemo: props.IsDemo ?? null,
    isAccessible: props.IsAccessible ?? null,
    ownershipType: props.OwnershipType || null,
    productGroupId: props.ProductGroupId || null,
    productGroupName: props.ProductGroupName || null,
    pdpBackgroundColor: props.PdpBackgroundColor || null,

    alternateIds: raw.AlternateIds || [],
    merchandizingTags: raw.MerchandizingTags || [],

    skus,

    // System requirements: take from first SKU that has hardware data
    systemRequirements: (() => {
      const allSkus = raw.DisplaySkuAvailabilities || [];
      for (const entry of allSkus) {
        const skuLp = entry.Sku?.LocalizedProperties?.[0] || {};
        const skuProps = entry.Sku?.Properties || {};
        const req = mapHardwareRequirements(skuProps, skuLp);
        if (req) return req;
      }
      return null;
    })(),

    officialStoreUrl: storeUrl(productId, title),
  };
}

module.exports = { mapProductDetail };
