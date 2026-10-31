using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Portal.Data.Migrations
{
    /// <inheritdoc />
    public partial class DealerStatusAndVkn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Orders_DealerId",
                schema: "sales",
                table: "Orders");

            migrationBuilder.RenameColumn(
                name: "TaxNumber",
                schema: "sales",
                table: "Dealers",
                newName: "VKN");

            migrationBuilder.AlterTable(
                name: "Dealers",
                schema: "sales",
                comment: "Yetkili satış noktaları");

            migrationBuilder.AlterColumn<int>(
                name: "ParentDealerId",
                schema: "sales",
                table: "Dealers",
                type: "int",
                nullable: true,
                comment: "Alt bayinin bağlı olduğu ana bayi",
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Name",
                schema: "catalog",
                table: "Products",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Dealer_Date",
                schema: "sales",
                table: "Orders",
                columns: new[] { "DealerId", "OrderedAt" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Dealers_Status",
                schema: "sales",
                table: "Dealers",
                sql: "[Status] IN (1, 2, 3)");

            // eski kayıtlarda durum 0 kalmış; CHECK'ten önce düzeltilmeliydi (DBA notu)
            migrationBuilder.Sql(@"UPDATE [sales].[Dealers] SET [Status] = 1 WHERE [Status] = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(name: "CK_Dealers_Status", schema: "sales", table: "Dealers");
            migrationBuilder.DropIndex(name: "IX_Orders_Dealer_Date", schema: "sales", table: "Orders");
            migrationBuilder.RenameColumn(name: "VKN", schema: "sales", table: "Dealers", newName: "TaxNumber");
        }
    }
}
