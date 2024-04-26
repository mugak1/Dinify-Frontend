import { NgModule } from "@angular/core";
import { CurrencyModule } from "./currency-input.module";

@NgModule({
    imports: [CurrencyModule],
    exports: [CurrencyModule],
  })
  export class InputModule {}