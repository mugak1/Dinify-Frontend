/**
 * RECORDED Backend kitchen-feed bytes for the D12 B3 consumer specs.
 *
 * GENERATED, NOT HAND-AUTHORED. Each `body` below is the exact `response.content`
 * of one real kitchen-feed request, captured by a private synthetic probe that drove
 * the Backend's real creation path (diner initiate + submit), its real kitchen command
 * route and the two real feeds against a disposable PostgreSQL database. The bytes are
 * split into chunks of the raw text and each chunk is a JSON-encoded string literal, so
 * the concatenation reproduces the recorded text exactly; the spec re-hashes it and
 * compares with `sha256`. Legacy rows in those captures were made with the same direct
 * column writes the Backend's own tests use, because no supported writer produces them.
 *
 * PROVENANCE (synthetic local capture; NOT live, NOT a serving identity):
 *   delivered — Dinify-Backend c65fe70770a5c99bff40f2b43e8926679321ebe7 (D12 B3, the first
 *               producer commit of Backend #367). Its kitchen serializer is AST-identical to
 *               the merged 43ac5540defb5e80d85a2a527c89946d2bd9cd37 and to main
 *               12541d50e22866251d1fb2280cc99253864e62e6 (comment-only delta); the creators,
 *               the provenance helpers, the kitchen views and the models are byte-identical.
 *   base      — Dinify-Backend 9b9c38c366b45e4e728013137beba4372dfd1316, before Backend #367:
 *               the same scenarios from a server that publishes NO provenance markers.
 *   capture   — private probe probe_kitchen_bytes.py,
 *               sha256 20e607175f7eb5d849da3dc22d9205aa7a7901b3f692745627f33bbe7f771dcc.
 *   generator — private gen_legacy_evidence_fixtures.py, sha256 d96602a870bc7c59c175fd22b6ff42cc4c2e3e68ade83fc746ea7608c14c1d31.
 *
 * Do not edit by hand: a changed byte fails the digest check in the spec.
 */

export interface RecordedKitchenFeed {
  /** `delivered` publishes the D12 B3 markers; `base` predates them. */
  producer: 'delivered' | 'base';
  /** The Dinify-Backend commit whose code emitted these bytes. */
  revision: string;
  feed: 'active' | 'completed';
  /** The route the probe requested. */
  url: string;
  /** Path of the captured file inside the private evidence bundle. */
  source: string;
  /** SHA-256 of the captured bytes, hex. */
  sha256: string;
  /** Length of the captured bytes. */
  bytes: number;
  /** Ticket count in `data`, as recorded. */
  tickets: number;
  /** The captured body, verbatim. */
  body: string;
}

export const RECORDED_KITCHEN_FEEDS: readonly RecordedKitchenFeed[] = [
  {
    producer: 'delivered',
    revision: 'c65fe70770a5c99bff40f2b43e8926679321ebe7',
    feed: 'active',
    url: '/api/v1/kitchen/orders/active/',
    source: 'delivered-c65fe70770a5c99bff40f2b43e8926679321ebe7/kitchen-active.response.json',
    sha256: '82bc82c2876ce45d09fb440a1efb8b89ee1fb30b906009e73a35f6b302a9af90',
    bytes: 4576,
    tickets: 4,
    body: "{\"status\":200,\"message\":\"Active kitchen orders retrieved\",\"kitchen_protocol\":1,\"data\":[{\"id\":\"dd"
      + "f69e5d-3759-40a2-8c81-e3607f1d1530\",\"order_number\":6,\"table_label\":\"4\",\"order_source\":\"diner_sel"
      + "f_service\",\"order_status\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status\":\"new\",\"priority\""
      + ":false,\"created_at\":\"2026-10-14T03:15:52.072820+03:00\",\"served_at\":null,\"items\":[{\"item_name_sna"
      + "pshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"item_name_proven"
      + "ance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\",\"extras"
      + "\":[]},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[\"Size: Large\"],\"allergen_tags\":[{\"icon\""
      + ":\"nut\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"item_name_provenance\":\"missing\",\"modifiers_provenance\""
      + ":\"missing\",\"allergen_tags_provenance\":\"missing\",\"extras\":[{\"item_name_snapshot\":\"Bacon Strip\",\"q"
      + "uantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"snapshot\",\"modifiers_proven"
      + "ance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\"},{\"item_name_snapshot\":\"Cheese Slice\",\"qu"
      + "antity\":2,\"modifiers\":[],\"allergen_tags\":[{\"icon\":\"milk\",\"name\":\"Milk\",\"colour\":\"amber\"}],\"item_"
      + "name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapsh"
      + "ot\"}]}]},{\"id\":\"aa8b5a32-6103-41ea-8e5e-255ea88b25cf\",\"order_number\":5,\"table_label\":\"3\",\"order_"
      + "source\":\"diner_self_service\",\"order_status\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status"
      + "\":\"new\",\"priority\":false,\"created_at\":\"2026-10-14T03:15:51.999100+03:00\",\"served_at\":null,\"items"
      + "\":[{\"item_name_snapshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[]"
      + ",\"item_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":"
      + "\"snapshot\",\"extras\":[]},{\"item_name_snapshot\":\"Beef Burger\",\"quantity\":2,\"modifiers\":[\"Size: Lar"
      + "ge\"],\"allergen_tags\":[{\"icon\":\"nut\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"item_name_provenance\":\"sn"
      + "apshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\",\"extras\":[{\"item"
      + "_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenan"
      + "ce\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\"},{\"item_n"
      + "ame_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"missing\""
      + ",\"modifiers_provenance\":\"missing\",\"allergen_tags_provenance\":\"missing\"}]}]},{\"id\":\"30b4fd18-af51"
      + "-47a4-ab86-1679abb88b7d\",\"order_number\":4,\"table_label\":\"2\",\"order_source\":\"diner_self_service\","
      + "\"order_status\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status\":\"new\",\"priority\":false,\"cre"
      + "ated_at\":\"2026-10-14T03:15:51.923338+03:00\",\"served_at\":null,\"items\":[{\"item_name_snapshot\":\"\",\""
      + "quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"missing\",\"modifiers_proven"
      + "ance\":\"missing\",\"allergen_tags_provenance\":\"missing\",\"extras\":[]},{\"item_name_snapshot\":\"\",\"quan"
      + "tity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"missing\",\"modifiers_provenance"
      + "\":\"missing\",\"allergen_tags_provenance\":\"missing\",\"extras\":[{\"item_name_snapshot\":\"\",\"quantity\":2"
      + ",\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"missing\",\"modifiers_provenance\":\"miss"
      + "ing\",\"allergen_tags_provenance\":\"missing\"},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],"
      + "\"allergen_tags\":[],\"item_name_provenance\":\"missing\",\"modifiers_provenance\":\"missing\",\"allergen_t"
      + "ags_provenance\":\"missing\"}]}]},{\"id\":\"1f96eb41-0602-4a0a-b4b8-127f37bda9af\",\"order_number\":3,\"ta"
      + "ble_label\":\"1\",\"order_source\":\"diner_self_service\",\"order_status\":\"pending\",\"fulfilment_revision"
      + "\":0,\"fulfilment_status\":\"new\",\"priority\":false,\"created_at\":\"2026-10-14T03:15:51.849964+03:00\",\""
      + "served_at\":null,\"items\":[{\"item_name_snapshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\""
      + ":[],\"allergen_tags\":[],\"item_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"alle"
      + "rgen_tags_provenance\":\"snapshot\",\"extras\":[]},{\"item_name_snapshot\":\"Beef Burger\",\"quantity\":2,\""
      + "modifiers\":[\"Size: Large\"],\"allergen_tags\":[{\"icon\":\"nut\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"ite"
      + "m_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snap"
      + "shot\",\"extras\":[{\"item_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":"
      + "[],\"item_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance"
      + "\":\"snapshot\"},{\"item_name_snapshot\":\"Cheese Slice\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":["
      + "{\"icon\":\"milk\",\"name\":\"Milk\",\"colour\":\"amber\"}],\"item_name_provenance\":\"snapshot\",\"modifiers_pro"
      + "venance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\"}]}]}]}",
  },
  {
    producer: 'delivered',
    revision: 'c65fe70770a5c99bff40f2b43e8926679321ebe7',
    feed: 'completed',
    url: '/api/v1/kitchen/orders/completed/',
    source: 'delivered-c65fe70770a5c99bff40f2b43e8926679321ebe7/kitchen-completed.response.json',
    sha256: '793f49c60d1793e9c6e69945659a819b32ef313ab0669de2da6903d25936cf70',
    bytes: 2350,
    tickets: 2,
    body: "{\"status\":200,\"message\":\"Completed kitchen orders retrieved\",\"kitchen_protocol\":1,\"data\":[{\"id\":"
      + "\"68d427c1-4ef7-4d3f-9625-a6b168fef7e1\",\"order_number\":2,\"table_label\":\"5\",\"order_source\":\"diner_"
      + "self_service\",\"order_status\":\"served\",\"fulfilment_revision\":3,\"fulfilment_status\":\"served\",\"prio"
      + "rity\":false,\"created_at\":\"2026-10-14T03:15:51.741743+03:00\",\"served_at\":\"2026-10-14T03:15:51.820"
      + "514+03:00\",\"items\":[{\"item_name_snapshot\":\"\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"ite"
      + "m_name_provenance\":\"missing\",\"modifiers_provenance\":\"missing\",\"allergen_tags_provenance\":\"missin"
      + "g\",\"extras\":[]},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_na"
      + "me_provenance\":\"missing\",\"modifiers_provenance\":\"missing\",\"allergen_tags_provenance\":\"missing\",\""
      + "extras\":[{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_prov"
      + "enance\":\"missing\",\"modifiers_provenance\":\"missing\",\"allergen_tags_provenance\":\"missing\"},{\"item_"
      + "name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_provenance\":\"missing"
      + "\",\"modifiers_provenance\":\"missing\",\"allergen_tags_provenance\":\"missing\"}]}]},{\"id\":\"0d895a31-f74"
      + "4-48a2-a610-6f052758bece\",\"order_number\":1,\"table_label\":\"5\",\"order_source\":\"diner_self_service\""
      + ",\"order_status\":\"served\",\"fulfilment_revision\":3,\"fulfilment_status\":\"served\",\"priority\":false,\""
      + "created_at\":\"2026-10-14T03:15:51.624027+03:00\",\"served_at\":\"2026-10-14T03:15:51.712785+03:00\",\"i"
      + "tems\":[{\"item_name_snapshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags"
      + "\":[],\"item_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenan"
      + "ce\":\"snapshot\",\"extras\":[]},{\"item_name_snapshot\":\"Beef Burger\",\"quantity\":2,\"modifiers\":[\"Size:"
      + " Large\"],\"allergen_tags\":[{\"icon\":\"nut\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"item_name_provenance\""
      + ":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\",\"extras\":[{\""
      + "item_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"item_name_prov"
      + "enance\":\"snapshot\",\"modifiers_provenance\":\"snapshot\",\"allergen_tags_provenance\":\"snapshot\"},{\"it"
      + "em_name_snapshot\":\"Cheese Slice\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[{\"icon\":\"milk\",\"na"
      + "me\":\"Milk\",\"colour\":\"amber\"}],\"item_name_provenance\":\"snapshot\",\"modifiers_provenance\":\"snapshot"
      + "\",\"allergen_tags_provenance\":\"snapshot\"}]}]}]}",
  },
  {
    producer: 'base',
    revision: '9b9c38c366b45e4e728013137beba4372dfd1316',
    feed: 'active',
    url: '/api/v1/kitchen/orders/active/',
    source: 'base-9b9c38c366b45e4e728013137beba4372dfd1316/kitchen-active.response.json',
    sha256: '6b248149ab52b5156193190dee52a0969f5fe9106b2d2b16b78e6a5a3b4ec3f4',
    bytes: 2898,
    tickets: 4,
    body: "{\"status\":200,\"message\":\"Active kitchen orders retrieved\",\"kitchen_protocol\":1,\"data\":[{\"id\":\"92"
      + "5344d5-3394-4fae-81c3-f4eb52b0dae8\",\"order_number\":6,\"table_label\":\"4\",\"order_source\":\"diner_sel"
      + "f_service\",\"order_status\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status\":\"new\",\"priority\""
      + ":false,\"created_at\":\"2026-10-14T03:15:27.942723+03:00\",\"served_at\":null,\"items\":[{\"item_name_sna"
      + "pshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[]},{\"it"
      + "em_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[\"Size: Large\"],\"allergen_tags\":[{\"icon\":\"nut\",\"na"
      + "me\":\"Peanuts\",\"colour\":\"red\"}],\"extras\":[{\"item_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modif"
      + "iers\":[],\"allergen_tags\":[]},{\"item_name_snapshot\":\"Cheese Slice\",\"quantity\":2,\"modifiers\":[],\"a"
      + "llergen_tags\":[{\"icon\":\"milk\",\"name\":\"Milk\",\"colour\":\"amber\"}]}]}]},{\"id\":\"18c529cd-70b5-4b9f-b0"
      + "86-3175437fa0ee\",\"order_number\":5,\"table_label\":\"3\",\"order_source\":\"diner_self_service\",\"order_s"
      + "tatus\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status\":\"new\",\"priority\":false,\"created_at\""
      + ":\"2026-10-14T03:15:27.841060+03:00\",\"served_at\":null,\"items\":[{\"item_name_snapshot\":\"Pasta_autod"
      + "el7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[]},{\"item_name_snapshot\":\""
      + "Beef Burger\",\"quantity\":2,\"modifiers\":[\"Size: Large\"],\"allergen_tags\":[{\"icon\":\"nut\",\"name\":\"Pea"
      + "nuts\",\"colour\":\"red\"}],\"extras\":[{\"item_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modifiers\":[]"
      + ",\"allergen_tags\":[]},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[]}]}]"
      + "},{\"id\":\"ffd1fdbc-1ae5-40d3-bd5e-c7c818f3559d\",\"order_number\":4,\"table_label\":\"2\",\"order_source\""
      + ":\"diner_self_service\",\"order_status\":\"pending\",\"fulfilment_revision\":0,\"fulfilment_status\":\"new\""
      + ",\"priority\":false,\"created_at\":\"2026-10-14T03:15:27.733404+03:00\",\"served_at\":null,\"items\":[{\"it"
      + "em_name_snapshot\":\"\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[]},{\"item_name_sna"
      + "pshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[{\"item_name_snapshot\":\"\",\"qua"
      + "ntity\":2,\"modifiers\":[],\"allergen_tags\":[]},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[]"
      + ",\"allergen_tags\":[]}]}]},{\"id\":\"d0076369-4d3c-41f3-96e2-7ef8692888c2\",\"order_number\":3,\"table_la"
      + "bel\":\"1\",\"order_source\":\"diner_self_service\",\"order_status\":\"pending\",\"fulfilment_revision\":0,\"f"
      + "ulfilment_status\":\"new\",\"priority\":false,\"created_at\":\"2026-10-14T03:15:27.646785+03:00\",\"served"
      + "_at\":null,\"items\":[{\"item_name_snapshot\":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"a"
      + "llergen_tags\":[],\"extras\":[]},{\"item_name_snapshot\":\"Beef Burger\",\"quantity\":2,\"modifiers\":[\"Siz"
      + "e: Large\"],\"allergen_tags\":[{\"icon\":\"nut\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"extras\":[{\"item_nam"
      + "e_snapshot\":\"Bacon Strip\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[]},{\"item_name_snapshot\":"
      + "\"Cheese Slice\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[{\"icon\":\"milk\",\"name\":\"Milk\",\"colour"
      + "\":\"amber\"}]}]}]}]}",
  },
  {
    producer: 'base',
    revision: '9b9c38c366b45e4e728013137beba4372dfd1316',
    feed: 'completed',
    url: '/api/v1/kitchen/orders/completed/',
    source: 'base-9b9c38c366b45e4e728013137beba4372dfd1316/kitchen-completed.response.json',
    sha256: '09a267cdad08b638f8c8ba1092b9032902336c5e7131950e3da0a686cc4b326a',
    bytes: 1514,
    tickets: 2,
    body: "{\"status\":200,\"message\":\"Completed kitchen orders retrieved\",\"kitchen_protocol\":1,\"data\":[{\"id\":"
      + "\"6d3f539a-307a-4770-af36-32252659a63c\",\"order_number\":2,\"table_label\":\"5\",\"order_source\":\"diner_"
      + "self_service\",\"order_status\":\"served\",\"fulfilment_revision\":3,\"fulfilment_status\":\"served\",\"prio"
      + "rity\":false,\"created_at\":\"2026-10-14T03:15:27.529999+03:00\",\"served_at\":\"2026-10-14T03:15:27.616"
      + "474+03:00\",\"items\":[{\"item_name_snapshot\":\"\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"ext"
      + "ras\":[]},{\"item_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[{\"ite"
      + "m_name_snapshot\":\"\",\"quantity\":2,\"modifiers\":[],\"allergen_tags\":[]},{\"item_name_snapshot\":\"\",\"qu"
      + "antity\":2,\"modifiers\":[],\"allergen_tags\":[]}]}]},{\"id\":\"acdb01a5-b14e-4b0b-9aff-dcb4e232fa10\",\"o"
      + "rder_number\":1,\"table_label\":\"5\",\"order_source\":\"diner_self_service\",\"order_status\":\"served\",\"fu"
      + "lfilment_revision\":3,\"fulfilment_status\":\"served\",\"priority\":false,\"created_at\":\"2026-10-14T03:1"
      + "5:27.389410+03:00\",\"served_at\":\"2026-10-14T03:15:27.496341+03:00\",\"items\":[{\"item_name_snapshot\""
      + ":\"Pasta_autodel7 Classic\",\"quantity\":1,\"modifiers\":[],\"allergen_tags\":[],\"extras\":[]},{\"item_nam"
      + "e_snapshot\":\"Beef Burger\",\"quantity\":2,\"modifiers\":[\"Size: Large\"],\"allergen_tags\":[{\"icon\":\"nut"
      + "\",\"name\":\"Peanuts\",\"colour\":\"red\"}],\"extras\":[{\"item_name_snapshot\":\"Bacon Strip\",\"quantity\":2,\""
      + "modifiers\":[],\"allergen_tags\":[]},{\"item_name_snapshot\":\"Cheese Slice\",\"quantity\":2,\"modifiers\":"
      + "[],\"allergen_tags\":[{\"icon\":\"milk\",\"name\":\"Milk\",\"colour\":\"amber\"}]}]}]}]}",
  },
];

/**
 * What each recorded order was made to be, as the probe recorded it beside the bytes.
 * Order ids differ between the two captures because each ran on a fresh database.
 */
export const RECORDED_SCENARIOS: Readonly<Record<RecordedKitchenFeed['producer'], {
  source: string; sha256: string; byId: Readonly<Record<string, string>>;
}>> = {
  delivered: {
    source: 'delivered-c65fe70770a5c99bff40f2b43e8926679321ebe7/scenarios.json',
    sha256: 'bfc457177da3b79e84c51fbfe1a79082c2354d8af1d8e9b8aa27c851208bc406',
    byId: {
      '0d895a31-f744-48a2-a610-6f052758bece': "completed: captured, served via commands",
      '1f96eb41-0602-4a0a-b4b8-127f37bda9af': "active: captured parent, captured extras, captured-empty pasta and bacon",
      '30b4fd18-af51-47a4-ab86-1679abb88b7d': "active: every line legacy-shaped",
      '68d427c1-4ef7-4d3f-9625-a6b168fef7e1': "completed: every line legacy-shaped, served via commands",
      'aa8b5a32-6103-41ea-8e5e-255ea88b25cf': "active: legacy Cheese Slice extra under a captured Beef Burger",
      'ddf69e5d-3759-40a2-8c81-e3607f1d1530': "active: Beef Burger name blanked, its stored lists kept",
    },
  },
  base: {
    source: 'base-9b9c38c366b45e4e728013137beba4372dfd1316/scenarios.json',
    sha256: 'e79ed01254e9a119684fa68f4810d8e14d573ef006e89c6cf2fbeeeb5cf4812b',
    byId: {
      '18c529cd-70b5-4b9f-b086-3175437fa0ee': "active: legacy Cheese Slice extra under a captured Beef Burger",
      '6d3f539a-307a-4770-af36-32252659a63c': "completed: every line legacy-shaped, served via commands",
      '925344d5-3394-4fae-81c3-f4eb52b0dae8': "active: Beef Burger name blanked, its stored lists kept",
      'acdb01a5-b14e-4b0b-9aff-dcb4e232fa10': "completed: captured, served via commands",
      'd0076369-4d3c-41f3-96e2-7ef8692888c2': "active: captured parent, captured extras, captured-empty pasta and bacon",
      'ffd1fdbc-1ae5-40d3-bd5e-c7c818f3559d': "active: every line legacy-shaped",
    },
  },
};
