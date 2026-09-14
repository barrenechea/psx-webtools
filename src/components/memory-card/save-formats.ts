import type { SaveFormatOption } from "@/hooks/use-save-file-form";
import {
  CardExtensions,
  CardTypes,
  RAW_EXTENSIONS,
  SingleSaveExtensions,
  SingleSaveTypes,
} from "@/lib/ps1-memory-card";
import type { Ps2SingleSaveFormat } from "@/lib/ps2/ps2-card";
import {
  PS2_RAW_EXTENSIONS,
  PS2_SINGLE_SAVE_EXTENSIONS,
  Ps2CardFormats,
  Ps2SingleSaveTypes,
} from "@/lib/ps2/ps2-types";

export const PS1_CARD_FORMATS: readonly SaveFormatOption<CardTypes>[] = [
  {
    value: CardTypes.Raw,
    label: "Raw Memory Card",
    extensions: RAW_EXTENSIONS,
  },
  {
    value: CardTypes.Mcx,
    label: "MCX Format (.mcx)",
    extensions: [CardExtensions[CardTypes.Mcx]],
  },
  {
    value: CardTypes.Vmp,
    label: "VMP Format (.vmp)",
    extensions: [CardExtensions[CardTypes.Vmp]],
  },
  {
    value: CardTypes.Vgs,
    label: "VGS Format (.vgs)",
    extensions: [CardExtensions[CardTypes.Vgs]],
  },
  {
    value: CardTypes.Gme,
    label: "GME Format (.gme)",
    extensions: [CardExtensions[CardTypes.Gme]],
  },
];

export const PS1_SINGLE_SAVE_FORMATS: readonly SaveFormatOption<SingleSaveTypes>[] =
  [
    {
      value: SingleSaveTypes.Mcs,
      label: "MCS single save (.mcs)",
      extensions: [SingleSaveExtensions[SingleSaveTypes.Mcs]],
    },
    {
      value: SingleSaveTypes.Psv,
      label: "PS3 single save (.psv)",
      extensions: [SingleSaveExtensions[SingleSaveTypes.Psv]],
    },
    {
      value: SingleSaveTypes.Psx,
      label: "Action Replay (.mcb)",
      extensions: [SingleSaveExtensions[SingleSaveTypes.Psx]],
    },
    {
      value: SingleSaveTypes.Raw,
      label: "RAW single save",
      extensions: [SingleSaveExtensions[SingleSaveTypes.Raw]],
    },
  ];

export const PS2_CARD_FORMATS: readonly SaveFormatOption<Ps2CardFormats>[] = [
  {
    value: Ps2CardFormats.Raw,
    label: "Raw Memory Card",
    extensions: PS2_RAW_EXTENSIONS,
  },
];

export const PS2_SINGLE_SAVE_FORMATS: readonly SaveFormatOption<Ps2SingleSaveTypes>[] =
  [
    {
      value: Ps2SingleSaveTypes.Sdt,
      label: "Single save (.sdt)",
      extensions: PS2_SINGLE_SAVE_EXTENSIONS,
    },
    {
      value: Ps2SingleSaveTypes.MaxDrive,
      label: "MAX Drive (.psu)",
      extensions: [".psu"],
    },
    {
      value: Ps2SingleSaveTypes.Ems,
      label: "EMS (.psu)",
      extensions: [".psu"],
    },
    {
      value: Ps2SingleSaveTypes.SharkPort,
      label: "SharkPort (.sps)",
      extensions: [".sps"],
    },
    {
      value: Ps2SingleSaveTypes.XPort,
      label: "X-Port (.xps)",
      extensions: [".xps"],
    },
    {
      value: Ps2SingleSaveTypes.CodeBreaker,
      label: "CodeBreaker (.cbs)",
      extensions: [".cbs"],
    },
    {
      value: Ps2SingleSaveTypes.Psv,
      label: "PSV (.psv)",
      extensions: [".psv"],
    },
  ];

/** Container format the card model accepts for each non-raw export type. */
export const PS2_EXPORT_CONTAINER_FORMAT: Partial<
  Record<Ps2SingleSaveTypes, Ps2SingleSaveFormat>
> = {
  [Ps2SingleSaveTypes.MaxDrive]: "max",
  [Ps2SingleSaveTypes.Ems]: "ems",
  [Ps2SingleSaveTypes.SharkPort]: "sharkport",
  [Ps2SingleSaveTypes.XPort]: "xport",
  [Ps2SingleSaveTypes.CodeBreaker]: "codebreaker",
  [Ps2SingleSaveTypes.Psv]: "psv",
};
