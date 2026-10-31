/*
 * Bayi portalı örneğinin EF Core migration geçmişi (tools/specs/bayi.js kullanır). Üç sürümün sonu, ModelSnapshot.cs
 * ile birebir aynı şemayı verir; test ikisini karşılaştırıp farkın sıfır olduğunu denetler.
 *   1. Initial              çekirdek tablolar (vergi no TaxNumber adıyla, ürün adı 100 karakter)
 *   2. Payments             ödeme tabloları (TPT), kullanıcıya bayi bağlantısı
 *   3. DealerStatusAndVkn   ad değişikliği, tip genişletme, CHECK, açıklamalar, indeks değişikliği, ham SQL
 */
'use strict';

const HEAD = name => `using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Portal.Data.Migrations
{
    /// <inheritdoc />
    public partial class ${name} : Migration
    {
`;
const TAIL = `    }
}
`;

const INITIAL = HEAD('Initial') + `        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "catalog");

            migrationBuilder.EnsureSchema(
                name: "sales");

            migrationBuilder.EnsureSchema(
                name: "crm");

            migrationBuilder.EnsureSchema(
                name: "identity");

            migrationBuilder.EnsureSchema(
                name: "portal");

            migrationBuilder.CreateTable(
                name: "Customers",
                schema: "crm",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "getutcdate()"),
                    CustomerType = table.Column<string>(type: "nvarchar(21)", maxLength: 21, nullable: false),
                    Email = table.Column<string>(type: "nvarchar(190)", maxLength: 190, nullable: true),
                    Msisdn = table.Column<string>(type: "nvarchar(15)", maxLength: 15, nullable: false),
                    CompanyTitle = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    TaxNumber = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FullName = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    NationalId = table.Column<string>(type: "nvarchar(11)", maxLength: 11, nullable: true, comment: "TCKN")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customers", x => x.Id);
                },
                comment: "Bireysel ve kurumsal müşteriler tek tabloda (CustomerType ayırır)");

            migrationBuilder.CreateTable(
                name: "ProductCategories",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    ParentId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductCategories_ProductCategories_ParentId",
                        column: x => x.ParentId,
                        principalSchema: "catalog",
                        principalTable: "ProductCategories",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Regions",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Code = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Regions", x => x.Id);
                    table.UniqueConstraint("AK_Regions_Code", x => x.Code);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Email = table.Column<string>(type: "nvarchar(190)", maxLength: 190, nullable: false),
                    UserName = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CategoryId = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    ListPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false, comment: "Stok kodu; cihaz ve hat paketlerinde aynı biçim")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Products_ProductCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "catalog",
                        principalTable: "ProductCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AuditLogs",
                schema: "portal",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Action = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    At = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UserId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AuditLogs_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Dealers",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "getutcdate()"),
                    CreatedById = table.Column<int>(type: "int", nullable: false),
                    DealerCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    ParentDealerId = table.Column<int>(type: "int", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false, comment: "1 = Aktif, 2 = Askıda, 3 = Kapalı"),
                    TaxNumber = table.Column<string>(type: "nvarchar(11)", maxLength: 11, nullable: true),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Address_City = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    Address_District = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    Address_Line1 = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Address_PostalCode = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Dealers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Dealers_ParentDealer",
                        column: x => x.ParentDealerId,
                        principalSchema: "sales",
                        principalTable: "Dealers",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Dealers_Users_CreatedById",
                        column: x => x.CreatedById,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DealerContacts",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DealerId = table.Column<int>(type: "int", nullable: false),
                    Email = table.Column<string>(type: "nvarchar(190)", maxLength: 190, nullable: true),
                    FullName = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Phone = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DealerContacts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DealerContacts_Dealers_DealerId",
                        column: x => x.DealerId,
                        principalSchema: "sales",
                        principalTable: "Dealers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DealerProfiles",
                schema: "sales",
                columns: table => new
                {
                    DealerId = table.Column<int>(type: "int", nullable: false),
                    AboutText = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LogoUrl = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    Website = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DealerProfiles", x => x.DealerId);
                    table.ForeignKey(
                        name: "FK_DealerProfiles_Dealers_DealerId",
                        column: x => x.DealerId,
                        principalSchema: "sales",
                        principalTable: "Dealers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DealerRegion",
                schema: "sales",
                columns: table => new
                {
                    DealersId = table.Column<int>(type: "int", nullable: false),
                    RegionsId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DealerRegion", x => new { x.DealersId, x.RegionsId });
                    table.ForeignKey(
                        name: "FK_DealerRegion_Dealers_DealersId",
                        column: x => x.DealersId,
                        principalSchema: "sales",
                        principalTable: "Dealers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DealerRegion_Regions_RegionsId",
                        column: x => x.RegionsId,
                        principalSchema: "sales",
                        principalTable: "Regions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Orders",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CreatedById = table.Column<int>(type: "int", nullable: false),
                    CustomerId = table.Column<int>(type: "int", nullable: false),
                    DealerId = table.Column<int>(type: "int", nullable: false),
                    OrderNo = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    OrderedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Orders_Customers_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "crm",
                        principalTable: "Customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Dealers_DealerId",
                        column: x => x.DealerId,
                        principalSchema: "sales",
                        principalTable: "Dealers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Users_CreatedById",
                        column: x => x.CreatedById,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderLines",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<long>(type: "bigint", nullable: false),
                    LineNo = table.Column<short>(type: "smallint", nullable: false),
                    ProductId = table.Column<int>(type: "int", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderLines", x => new { x.OrderId, x.LineNo });
                    table.ForeignKey(
                        name: "FK_OrderLines_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OrderLines_Products_ProductId",
                        column: x => x.ProductId,
                        principalSchema: "catalog",
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_UserId_At",
                schema: "portal",
                table: "AuditLogs",
                columns: new[] { "UserId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Customers_Msisdn",
                schema: "crm",
                table: "Customers",
                column: "Msisdn");

            migrationBuilder.CreateIndex(
                name: "IX_DealerContacts_DealerId",
                schema: "sales",
                table: "DealerContacts",
                column: "DealerId");

            migrationBuilder.CreateIndex(
                name: "IX_DealerRegion_RegionsId",
                schema: "sales",
                table: "DealerRegion",
                column: "RegionsId");

            migrationBuilder.CreateIndex(
                name: "IX_Dealers_CreatedById",
                schema: "sales",
                table: "Dealers",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_Dealers_DealerCode",
                schema: "sales",
                table: "Dealers",
                column: "DealerCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Dealers_ParentDealerId",
                schema: "sales",
                table: "Dealers",
                column: "ParentDealerId");

            migrationBuilder.CreateIndex(
                name: "IX_OrderLines_ProductId",
                schema: "sales",
                table: "OrderLines",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CreatedById",
                schema: "sales",
                table: "Orders",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CustomerId",
                schema: "sales",
                table: "Orders",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_DealerId",
                schema: "sales",
                table: "Orders",
                column: "DealerId");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_OrderNo",
                schema: "sales",
                table: "Orders",
                column: "OrderNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductCategories_ParentId",
                schema: "catalog",
                table: "ProductCategories",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_CategoryId",
                schema: "catalog",
                table: "Products",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_Sku",
                schema: "catalog",
                table: "Products",
                column: "Sku",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_UserName",
                schema: "identity",
                table: "Users",
                column: "UserName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AuditLogs", schema: "portal");
            migrationBuilder.DropTable(name: "DealerContacts", schema: "sales");
            migrationBuilder.DropTable(name: "DealerProfiles", schema: "sales");
            migrationBuilder.DropTable(name: "DealerRegion", schema: "sales");
            migrationBuilder.DropTable(name: "OrderLines", schema: "sales");
            migrationBuilder.DropTable(name: "Regions", schema: "sales");
            migrationBuilder.DropTable(name: "Orders", schema: "sales");
            migrationBuilder.DropTable(name: "Products", schema: "catalog");
            migrationBuilder.DropTable(name: "Customers", schema: "crm");
            migrationBuilder.DropTable(name: "Dealers", schema: "sales");
            migrationBuilder.DropTable(name: "ProductCategories", schema: "catalog");
            migrationBuilder.DropTable(name: "Users", schema: "identity");
        }
` + TAIL;

const PAYMENTS = HEAD('Payments') + `        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "finance");

            migrationBuilder.AddColumn<int>(
                name: "DealerId",
                schema: "identity",
                table: "Users",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Payments",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    OrderId = table.Column<long>(type: "bigint", nullable: false),
                    PaidAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Payments_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CardPayments",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false),
                    Installments = table.Column<byte>(type: "tinyint", nullable: false),
                    MaskedPan = table.Column<string>(type: "nvarchar(19)", maxLength: 19, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CardPayments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CardPayments_Payments_Id",
                        column: x => x.Id,
                        principalSchema: "finance",
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TransferPayments",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false),
                    Iban = table.Column<string>(type: "nvarchar(34)", maxLength: 34, nullable: false),
                    ReferenceNo = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TransferPayments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TransferPayments_Payments_Id",
                        column: x => x.Id,
                        principalSchema: "finance",
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_DealerId",
                schema: "identity",
                table: "Users",
                column: "DealerId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_OrderId",
                schema: "finance",
                table: "Payments",
                column: "OrderId");

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Dealers_DealerId",
                schema: "identity",
                table: "Users",
                column: "DealerId",
                principalSchema: "sales",
                principalTable: "Dealers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_Users_Dealers_DealerId", schema: "identity", table: "Users");
            migrationBuilder.DropTable(name: "CardPayments", schema: "finance");
            migrationBuilder.DropTable(name: "TransferPayments", schema: "finance");
            migrationBuilder.DropTable(name: "Payments", schema: "finance");
            migrationBuilder.DropIndex(name: "IX_Users_DealerId", schema: "identity", table: "Users");
            migrationBuilder.DropColumn(name: "DealerId", schema: "identity", table: "Users");
        }
` + TAIL;

const STATUS = HEAD('DealerStatusAndVkn') + `        /// <inheritdoc />
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
` + TAIL;

const DESIGNER = `// <auto-generated />
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Portal.Data;

#nullable disable

namespace Portal.Data.Migrations
{
    [DbContext(typeof(PortalDbContext))]
    [Migration("20240610150000_DealerStatusAndVkn")]
    partial class DealerStatusAndVkn
    {
        /// <inheritdoc />
        protected override void BuildTargetModel(ModelBuilder modelBuilder)
        {
            // Bu dosya migration anındaki modelin tam kopyasıdır; sqlSchema okumaz (ModelSnapshot.cs ile aynı biçim).
        }
    }
}
`;

module.exports = {
  '20240115093000_Initial.cs': INITIAL,
  '20240402110000_Payments.cs': PAYMENTS,
  '20240610150000_DealerStatusAndVkn.cs': STATUS,
  '20240610150000_DealerStatusAndVkn.Designer.cs': DESIGNER,
};
