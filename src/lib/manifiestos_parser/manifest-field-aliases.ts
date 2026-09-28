export const MANIFEST_SECTION_ALIASES = {
  HEADER: [
    "MANIFIESTO ELECTRONICO DE CARGA",
  ],

  MANIFEST_INFORMATION: [
    "INFORMACION DEL MANIFIESTO DE CARGA",
  ],

  VEHICLE_AND_DRIVER: [
    "INFORMACION DEL VEHICULO Y CONDUCTOR",
  ],

  CARGO_INFORMATION: [
    "INFORMACION DE LA MERCANCIA TRANSPORTADA",
  ],

  PAYMENT: [
    "VALOR DEL VIAJE",
  ],

  RECOMMENDATIONS: [
    "RECOMENDACIONES",
  ],
} as const;

export const FIELD_ALIASES = {
  company: {
    nit: ["NIT", "NIT."],
    address: ["DIRECCION", "DIRECCIÓN"],
    phone: ["TELEFONO", "TELÉFONO"],
    city: ["CIUDAD"],
  },

  manifest: {
    manifestNumber: ["MANIFIESTO"],
    authorizationNumber: ["AUTORIZACION", "AUTORIZACIÓN"],
    issueDate: [
      "FECHA EXPED",
      "FECHA DE EXPEDICION",
      "FECHA DE EXPEDICION (DIA/MES/AÑO)",
      "FECHA DE EXPEDICION (DIA/MES/AÑO)",
    ],
    manifestType: ["TIPO MANIFIESTO"],
    origin: ["ORIGEN DEL VIAJE"],
    intermediateCity: ["CIUDAD INTERMEDIA", "CIUDAD INTEMEDIA"],
    destination: ["DESTINO DEL VIAJE"],
    totalTripValue: ["VALOR TOTAL DEL VIAJE"],
    withholdingTax: ["RETENCION EN LA FUENTE", "RETENCIÓN EN LA FUENTE"],
    icaWithholding: ["RETENCION ICA", "RETENCIÓN ICA"],
    netValueToPay: ["VALOR NETO A PAGAR"],
    advanceValue: ["VALOR ANTICIPO"],
    balanceToPay: ["SALDO A PAGAR"],
    paymentLocation: ["LUGAR"],
    paymentDate: ["FECHA"],
    loadingPaidBy: ["CARGUE PAGADO POR"],
    unloadingPaidBy: ["DESCARGUE PAGADO POR"],
    agreedValueInWords: ["VALOR A PAGAR PACTADO EN LETRAS"],
    recommendations: ["RECOMENDACIONES"],
    policyOwnerName: ["DUEÑO POLIZA", "DUEÑO PÓLIZA", "DUEÑOPOLIZA", "DUEÑO POLIZA"],
  },

  manifestHolder: {
    fullName: ["TITULAR MANIFIESTO"],
    identificationNumber: [
      "DOCTO DE IDENTIFICACION NO.",
      "DOCTO DE IDENTIFICACION NO",
    ],
  },

  driver: {
    fullName: ["CONDUCTOR"],
    identificationNumber: [
      "DOCTO. DE IDENTIFICACION NO.",
      "DOCTO DE IDENTIFICACION NO.",
      "DOCTO. DE IDENTIFICACION NO",
    ],
    licenseCategory: ["CAT. LIC. CONDUCCION", "CAT. LIC. CONDUCCIÓN"],
  },

  vehicleHolder: {
    fullName: ["POSEEDOR O TENEDOR DEL VEHICULO", "POSEEDOR O TENEDOR DEL VEHÍCULO"],
  },

  vehicle: {
    plate: ["PLACA"],
    brand: ["MARCA"],
    semiTrailerPlate: ["PLACA SEMIREMOLQUE", "PLACA SEMI REMOLQUE"],
    configuration: ["CONFIGURACION", "CONFIGURACIÓN"],
    emptyWeight: ["PESO VACIO", "PESO VACÍO"],
    soatPolicyNumber: ["N POLIZA SOAT", "N° POLIZA SOAT", "N° PÓLIZA SOAT"],
    soatInsuranceCompany: ["CIA. SEGURA SOAT", "CIA SEGURA SOAT"],
    soatExpirationDate: ["VENCIMIENTO SOAT"],
  },

  cargo: {
    remittanceNumber: ["NUMERO DE REMESA", "NÚMERO DE REMESA"],
    measurementUnit: ["UNIDAD DE MEDIDA"],
    quantity: ["CANTIDAD"],
    nature: ["NATURALEZA"],
    packaging: ["EMPAQUE"],
    productCode: ["CODIGO DE PRODUCTO", "CÓDIGO DE PRODUCTO"],
    transportedProduct: ["PRODUCTO TRANSPORTADO"],
  },

  party: {
    identification: ["NIT / CC", "NIT/CC"],
    name: ["NOMBRE / RAZON SOCIAL", "NOMBRE / RAZÓN SOCIAL"],
  },
} as const;
